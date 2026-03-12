using System.Net;
using System.Text;
using System.Text.Json;
using KokoroSharp;

namespace VoiceServer;

/// <summary>
/// Lightweight HTTP voice server for Claude Dev Studio.
/// POST /speak  { "text": "Hello world" }  → queues text for Kokoro TTS playback
/// GET  /status                             → returns { "ready": true/false }
/// All speech is queued and played serially via KokoroSharp's built-in dispatcher.
/// </summary>
class Program
{
    const string Prefix = "http://localhost:62001/";
    const string Voice  = "af_heart";   // warm American female voice

    static KokoroTTS?   _tts    = null;
    static dynamic?     _voice  = null;   // KokoroVoice — use dynamic to avoid type name ambiguity
    static volatile bool _ready = false;

    static async Task Main(string[] args)
    {
        Console.WriteLine("[VoiceServer] Starting on http://localhost:62001/");

        // Load model on background thread so HTTP server starts immediately
        _ = Task.Run(() =>
        {
            try
            {
                Console.WriteLine("[VoiceServer] Loading Kokoro model (first run may download ~320MB)...");
                // Pin working dir so LoadModel() downloads to exe folder, not system32
                Directory.SetCurrentDirectory(AppDomain.CurrentDomain.BaseDirectory);
                var modelPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "kokoro.onnx");
                _tts = File.Exists(modelPath)
                    ? KokoroTTS.LoadModel(modelPath)
                    : KokoroTTS.LoadModel();   // downloads ~320MB to current dir on first run
                _voice = KokoroVoiceManager.GetVoice(Voice);
                _ready = true;
                Console.WriteLine("[VoiceServer] Kokoro ready — voice: " + Voice);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("[VoiceServer] Kokoro load failed: " + ex.Message);
            }
        });

        var listener = new HttpListener();
        listener.Prefixes.Add(Prefix);
        listener.Start();
        Console.WriteLine("[VoiceServer] Listening...");

        while (true)
        {
            try
            {
                var ctx = await listener.GetContextAsync();
                _ = Task.Run(() => HandleRequest(ctx));
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("[VoiceServer] Listener error: " + ex.Message);
                break;
            }
        }
    }

    static async Task HandleRequest(HttpListenerContext ctx)
    {
        var req  = ctx.Request;
        var resp = ctx.Response;
        resp.ContentType = "application/json; charset=utf-8";
        resp.Headers.Add("Access-Control-Allow-Origin", "*");

        try
        {
            string body;
            var path = req.Url?.AbsolutePath.TrimEnd('/') ?? "";

            if (req.HttpMethod == "GET" && path == "/status")
            {
                body = JsonSerializer.Serialize(new { ready = _ready });
            }
            else if (req.HttpMethod == "POST" && path == "/speak")
            {
                using var sr = new StreamReader(req.InputStream, Encoding.UTF8);
                var json     = await sr.ReadToEndAsync();
                var doc      = JsonDocument.Parse(json);
                var text     = doc.RootElement.GetProperty("text").GetString() ?? "";

                if (string.IsNullOrWhiteSpace(text))
                {
                    resp.StatusCode = 400;
                    body = @"{""error"":""text is required""}";
                }
                else if (!_ready || _tts == null || _voice == null)
                {
                    resp.StatusCode = 503;
                    body = @"{""error"":""Kokoro not ready yet""}";
                }
                else
                {
                    var preview = text.Length > 60 ? text[..60] + "..." : text;
                    Console.WriteLine($"[VoiceServer] Speaking: {preview}");
                    _tts!.SpeakFast(text, _voice);
                    body = JsonSerializer.Serialize(new { ok = true, chars = text.Length });
                }
            }
            else
            {
                resp.StatusCode = 404;
                body = @"{""error"":""Not found""}";
            }

            var bytes = Encoding.UTF8.GetBytes(body);
            resp.ContentLength64 = bytes.Length;
            await resp.OutputStream.WriteAsync(bytes);
        }
        catch (Exception ex)
        {
            var err = Encoding.UTF8.GetBytes($@"{{""error"":""{ex.Message}""}}");
            try { resp.StatusCode = 500; await resp.OutputStream.WriteAsync(err); } catch { }
        }
        finally
        {
            try { resp.OutputStream.Close(); } catch { }
        }
    }
}
