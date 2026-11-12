// The Al-Esnad print agent — the half of dialog-free printing that runs on
// the counter PC. Compiled at start by print-agent.ps1 with the C# compiler
// every Windows already has (.NET Framework 4), so nothing is installed.
//
// ⚠️ C# 5 only: Add-Type in Windows PowerShell 5.1 compiles with the .NET
// Framework's csc, which knows no string interpolation, no `?.`, no `out var`
// and no expression-bodied members.
//
// What it does, and nothing else:
//   GET  /v1/status          who is answering
//   GET  /v1/printers        every installed printer, read from the spooler,
//                            with its state and whether a USB printer is
//                            actually plugged in right now
//   POST /v1/print           a raw job (the label's TSPL) or a picture
//                            (the A5 receipt) to ONE named printer
//   GET  /v1/job?token=…     what the Windows queue has said about that job
//   POST /v1/cancel          removes one job from a queue
//   POST /v1/quit            stops the agent (local tools only)
//
// Who may ask: a page served from an origin on the allowlist (the browser
// sends Origin and cannot fake it), carrying the X-Al-Esnad-Print header —
// which a plain <img> or <form> cannot send, so a stranger's page cannot even
// try without a preflight this agent refuses. A request with no Origin at all
// comes from a program on this PC, which could print without us anyway.
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Printing;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using Microsoft.Win32;

namespace AlEsnadPrint
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    internal struct DOC_INFO_1
    {
        public string pDocName;
        public string pOutputFile;
        public string pDatatype;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    internal struct PRINTER_INFO_2
    {
        public string pServerName;
        public string pPrinterName;
        public string pShareName;
        public string pPortName;
        public string pDriverName;
        public string pComment;
        public string pLocation;
        public IntPtr pDevMode;
        public string pSepFile;
        public string pPrintProcessor;
        public string pDatatype;
        public string pParameters;
        public IntPtr pSecurityDescriptor;
        public uint Attributes;
        public uint Priority;
        public uint DefaultPriority;
        public uint StartTime;
        public uint UntilTime;
        public uint Status;
        public uint cJobs;
        public uint AveragePPM;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct SYSTEMTIME
    {
        public ushort Year, Month, DayOfWeek, Day, Hour, Minute, Second, Milliseconds;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    internal struct JOB_INFO_1
    {
        public uint JobId;
        public string pPrinterName;
        public string pMachineName;
        public string pUserName;
        public string pDocument;
        public string pDatatype;
        public string pStatus;
        public uint Status;
        public uint Priority;
        public uint Position;
        public uint TotalPages;
        public uint PagesPrinted;
        public SYSTEMTIME Submitted;
    }

    internal static class Native
    {
        [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern bool EnumPrinters(uint flags, string name, uint level, IntPtr buffer, uint size, out uint needed, out uint returned);

        [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);

        [DllImport("winspool.drv", SetLastError = true)]
        public static extern bool ClosePrinter(IntPtr handle);

        [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern int StartDocPrinter(IntPtr handle, uint level, [In] ref DOC_INFO_1 info);

        [DllImport("winspool.drv", SetLastError = true)]
        public static extern bool EndDocPrinter(IntPtr handle);

        [DllImport("winspool.drv", SetLastError = true)]
        public static extern bool StartPagePrinter(IntPtr handle);

        [DllImport("winspool.drv", SetLastError = true)]
        public static extern bool EndPagePrinter(IntPtr handle);

        [DllImport("winspool.drv", SetLastError = true)]
        public static extern bool WritePrinter(IntPtr handle, byte[] buffer, int size, out int written);

        [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern bool EnumJobs(IntPtr handle, uint first, uint count, uint level, IntPtr buffer, uint size, out uint needed, out uint returned);

        [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern bool SetJob(IntPtr handle, uint jobId, uint level, IntPtr job, uint command);

        [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode)]
        public static extern int CM_Locate_DevNodeW(out uint devInst, string deviceId, uint flags);

        public const uint PRINTER_ENUM_LOCAL = 0x2;
        public const uint PRINTER_ENUM_CONNECTIONS = 0x4;
        public const uint JOB_CONTROL_DELETE = 5;
    }

    /// <summary>What the Windows queue has said about one job, collected as it happens.</summary>
    internal sealed class Track
    {
        public readonly object Gate = new object();
        public string Token;
        public string Printer;
        public string JobName;
        public uint JobId;
        public bool EverSeen;
        public bool Gone;
        public bool TimedOut;
        public readonly List<string> Seen = new List<string>();
        public List<string> Current = new List<string>();
        public DateTime Started = DateTime.UtcNow;
    }

    public static class Agent
    {
        public const int Version = 1;
        private const string Header = "X-Al-Esnad-Print";
        private const int MaxBody = 24 * 1024 * 1024;

        private static HttpListener listener;
        private static HashSet<string> origins;
        private static string logPath;
        private static int port;
        private static readonly object logGate = new object();
        private static readonly ConcurrentDictionary<string, Track> tracks = new ConcurrentDictionary<string, Track>();
        private static readonly ConcurrentDictionary<string, List<Dictionary<string, object>>> sizeCache =
            new ConcurrentDictionary<string, List<Dictionary<string, object>>>();
        private static readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };

        public static int Run(int listenPort, string[] allowedOrigins, string logFile)
        {
            port = listenPort;
            logPath = logFile;
            origins = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (string origin in allowedOrigins)
            {
                if (!string.IsNullOrWhiteSpace(origin)) origins.Add(origin.Trim().TrimEnd('/'));
            }

            // A request thread must never take the agent down with it; if one
            // somehow does, the stack trace is in the log rather than nowhere.
            AppDomain.CurrentDomain.UnhandledException += delegate (object sender, UnhandledExceptionEventArgs e)
            {
                Log("FATAL: " + e.ExceptionObject);
            };

            listener = new HttpListener();
            // Loopback only. http.sys refuses any other Host, which is also what
            // stops a DNS-rebound name from reaching this port as same-origin.
            listener.Prefixes.Add("http://127.0.0.1:" + port + "/");
            listener.Prefixes.Add("http://localhost:" + port + "/");
            try
            {
                listener.Start();
            }
            catch (HttpListenerException error)
            {
                Log("cannot listen on port " + port + ": " + error.Message + " - is the agent already running?");
                return 2;
            }

            Log("listening on http://127.0.0.1:" + port + " for " + string.Join(", ", origins));
            // Paper sizes are the slow part of the printer list (~150 ms a printer);
            // read them once now, so the first print does not wait for them.
            ThreadPool.QueueUserWorkItem(delegate { try { ListPrinters(true); } catch (Exception) { } });

            while (listener.IsListening)
            {
                HttpListenerContext context;
                try
                {
                    context = listener.GetContext();
                }
                catch (Exception)
                {
                    break;
                }
                HttpListenerContext captured = context;
                ThreadPool.QueueUserWorkItem(delegate
                {
                    try
                    {
                        Handle(captured);
                    }
                    catch (Exception error)
                    {
                        Log("request failed: " + error);
                    }
                });
            }
            Log("stopped");
            return 0;
        }

        // ── HTTP ──────────────────────────────────────────────────────────────

        private static void Handle(HttpListenerContext context)
        {
            HttpListenerRequest request = context.Request;
            HttpListenerResponse response = context.Response;
            string origin = request.Headers["Origin"];
            bool allowed = string.IsNullOrEmpty(origin) || origins.Contains(origin.TrimEnd('/'));
            // ⚠️ Read up front: closing the response disposes the request, and
            // touching it afterwards throws on a pool thread — which killed the
            // whole agent (ObjectDisposedException in CheckDisposed, measured).
            string path = request.Url.AbsolutePath.TrimEnd('/');
            string method = request.HttpMethod;
            DateTime started = DateTime.UtcNow;
            int status = 200;
            try
            {
                // ⚠️ http.sys does NOT refuse a foreign Host on a loopback
                // prefix — measured: Host: attacker.example answered 200. A
                // DNS-rebound name would then be same-origin with this port, so
                // the Host is checked here, by name.
                string host = (request.UserHostName ?? "").ToLowerInvariant();
                int colon = host.LastIndexOf(':');
                string hostName = colon > 0 ? host.Substring(0, colon) : host;
                if (hostName != "127.0.0.1" && hostName != "localhost")
                {
                    status = 421;
                    Reply(response, 421, Error("host_not_allowed"));
                    return;
                }
                response.Headers["Cache-Control"] = "no-store";
                response.Headers["Vary"] = "Origin";
                if (!string.IsNullOrEmpty(origin) && allowed)
                {
                    response.Headers["Access-Control-Allow-Origin"] = origin;
                }

                if (request.HttpMethod == "OPTIONS")
                {
                    if (!allowed)
                    {
                        status = 403;
                        Reply(response, 403, Error("origin_not_allowed"));
                        return;
                    }
                    response.Headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
                    response.Headers["Access-Control-Allow-Headers"] = "content-type, " + Header.ToLowerInvariant();
                    // Chrome's private-network preflight: a public site asking for
                    // something on this computer must be answered in so many words.
                    response.Headers["Access-Control-Allow-Private-Network"] = "true";
                    response.Headers["Access-Control-Max-Age"] = "600";
                    status = 204;
                    response.StatusCode = 204;
                    response.Close();
                    return;
                }

                if (!allowed)
                {
                    status = 403;
                    Reply(response, 403, Error("origin_not_allowed"));
                    return;
                }
                if (request.Headers[Header] != "1")
                {
                    status = 403;
                    Reply(response, 403, Error("header_required"));
                    return;
                }

                Dictionary<string, object> result;
                if (request.HttpMethod == "GET" && path == "/v1/status")
                {
                    result = Ok();
                    result["agent"] = "al-esnad-print";
                    result["version"] = Version;
                    result["machine"] = Environment.MachineName;
                    result["user"] = Environment.UserName;
                }
                else if (request.HttpMethod == "GET" && path == "/v1/printers")
                {
                    bool fresh = request.QueryString["fresh"] == "1";
                    result = Ok();
                    result["printers"] = ListPrinters(fresh);
                }
                else if (request.HttpMethod == "GET" && path == "/v1/job")
                {
                    result = JobState(request.QueryString["token"]);
                }
                else if (request.HttpMethod == "POST" && path == "/v1/print")
                {
                    result = Print(ReadBody(request));
                }
                else if (request.HttpMethod == "POST" && path == "/v1/cancel")
                {
                    result = Cancel(ReadBody(request));
                }
                else if (request.HttpMethod == "POST" && path == "/v1/quit" && string.IsNullOrEmpty(origin))
                {
                    Reply(response, 200, Ok());
                    Log("quit requested");
                    listener.Stop();
                    return;
                }
                else
                {
                    status = 404;
                    Reply(response, 404, Error("not_found"));
                    return;
                }

                status = result.ContainsKey("status") ? Convert.ToInt32(result["status"]) : 200;
                result.Remove("status");
                Reply(response, status, result);
            }
            catch (Exception error)
            {
                status = 500;
                Log("error on " + path + ": " + error.Message);
                try { Reply(response, 500, Error(error.Message)); } catch (Exception) { }
            }
            finally
            {
                if (path != "/v1/job")
                {
                    Log(method + " " + path + " " + status + " (" + (int)(DateTime.UtcNow - started).TotalMilliseconds + " ms)" +
                        (string.IsNullOrEmpty(origin) ? "" : " from " + origin));
                }
            }
        }

        private static Dictionary<string, object> ReadBody(HttpListenerRequest request)
        {
            using (MemoryStream buffer = new MemoryStream())
            {
                byte[] chunk = new byte[81920];
                int read;
                while ((read = request.InputStream.Read(chunk, 0, chunk.Length)) > 0)
                {
                    buffer.Write(chunk, 0, read);
                    if (buffer.Length > MaxBody) throw new InvalidOperationException("body_too_large");
                }
                string text = Encoding.UTF8.GetString(buffer.ToArray());
                Dictionary<string, object> body = json.DeserializeObject(text) as Dictionary<string, object>;
                if (body == null) throw new InvalidOperationException("bad_request");
                return body;
            }
        }

        private static void Reply(HttpListenerResponse response, int status, object body)
        {
            byte[] bytes = Encoding.UTF8.GetBytes(json.Serialize(body));
            response.StatusCode = status;
            response.ContentType = "application/json; charset=utf-8";
            response.ContentLength64 = bytes.Length;
            response.OutputStream.Write(bytes, 0, bytes.Length);
            response.Close();
        }

        private static Dictionary<string, object> Ok()
        {
            Dictionary<string, object> result = new Dictionary<string, object>();
            result["ok"] = true;
            return result;
        }

        private static Dictionary<string, object> Error(string code)
        {
            Dictionary<string, object> result = new Dictionary<string, object>();
            result["ok"] = false;
            result["error"] = code;
            return result;
        }

        private static Dictionary<string, object> Failure(int status, string code)
        {
            Dictionary<string, object> result = Error(code);
            result["status"] = status;
            return result;
        }

        private static string Text(Dictionary<string, object> body, string key)
        {
            object value;
            return body.TryGetValue(key, out value) && value != null ? Convert.ToString(value) : null;
        }

        private static double Number(Dictionary<string, object> body, string key, double fallback)
        {
            object value;
            if (!body.TryGetValue(key, out value) || value == null) return fallback;
            try { return Convert.ToDouble(value, System.Globalization.CultureInfo.InvariantCulture); }
            catch (Exception) { return fallback; }
        }

        private static bool Flag(Dictionary<string, object> body, string key)
        {
            object value;
            return body.TryGetValue(key, out value) && value is bool && (bool)value;
        }

        // ── Printers ──────────────────────────────────────────────────────────

        private static readonly string[] PrinterStatusNames =
        {
            "PAUSED", "ERROR", "PENDING_DELETION", "PAPER_JAM", "PAPER_OUT", "MANUAL_FEED", "PAPER_PROBLEM",
            "OFFLINE", "IO_ACTIVE", "BUSY", "PRINTING", "OUTPUT_BIN_FULL", "NOT_AVAILABLE", "WAITING",
            "PROCESSING", "INITIALIZING", "WARMING_UP", "TONER_LOW", "NO_TONER", "PAGE_PUNT",
            "USER_INTERVENTION", "OUT_OF_MEMORY", "DOOR_OPEN", "SERVER_UNKNOWN", "POWER_SAVE",
        };

        private static readonly string[] JobStatusNames =
        {
            "PAUSED", "ERROR", "DELETING", "SPOOLING", "PRINTING", "OFFLINE", "PAPEROUT", "PRINTED",
            "DELETED", "BLOCKED_DEVQ", "USER_INTERVENTION", "RESTART", "COMPLETE", "RETAINED", "RENDERING_LOCALLY",
        };

        private static List<string> Names(uint bits, string[] names)
        {
            List<string> list = new List<string>();
            for (int bit = 0; bit < names.Length; bit++)
            {
                if ((bits & (1u << bit)) != 0) list.Add(names[bit]);
            }
            return list;
        }

        private static List<PRINTER_INFO_2> EnumPrinters()
        {
            List<PRINTER_INFO_2> list = new List<PRINTER_INFO_2>();
            uint flags = Native.PRINTER_ENUM_LOCAL | Native.PRINTER_ENUM_CONNECTIONS;
            uint needed, returned;
            Native.EnumPrinters(flags, null, 2, IntPtr.Zero, 0, out needed, out returned);
            if (needed == 0) return list;
            IntPtr buffer = Marshal.AllocHGlobal((int)needed);
            try
            {
                if (!Native.EnumPrinters(flags, null, 2, buffer, needed, out needed, out returned))
                {
                    throw new InvalidOperationException("EnumPrinters failed: " + Marshal.GetLastWin32Error());
                }
                int size = Marshal.SizeOf(typeof(PRINTER_INFO_2));
                for (int index = 0; index < returned; index++)
                {
                    IntPtr item = new IntPtr(buffer.ToInt64() + index * size);
                    list.Add((PRINTER_INFO_2)Marshal.PtrToStructure(item, typeof(PRINTER_INFO_2)));
                }
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }
            return list;
        }

        /// <summary>
        /// USB printer ports (USB001…) mapped to whether the device behind them is
        /// plugged in right now. Windows keeps a USB printer's queue after the
        /// cable is pulled; the device node is what disappears.
        /// </summary>
        private static Dictionary<string, bool> UsbPresence()
        {
            Dictionary<string, bool> ports = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase);
            const string usbPrintClass = @"SYSTEM\CurrentControlSet\Control\DeviceClasses\{28d78fad-5a12-11d1-ae5b-0000f803a8c2}";
            using (RegistryKey root = Registry.LocalMachine.OpenSubKey(usbPrintClass))
            {
                if (root == null) return ports;
                foreach (string name in root.GetSubKeyNames())
                {
                    using (RegistryKey parameters = root.OpenSubKey(name + @"\#\Device Parameters"))
                    {
                        if (parameters == null) continue;
                        object baseName = parameters.GetValue("Base Name");
                        object number = parameters.GetValue("Port Number");
                        if (baseName == null || number == null) continue;
                        string port = Convert.ToString(baseName) + Convert.ToInt32(number).ToString("000");
                        // ##?#USB#VID_20D1&PID_7008#SERIAL#{guid} → USB\VID_20D1&PID_7008\SERIAL
                        string instance = name;
                        if (instance.StartsWith("##?#")) instance = instance.Substring(4);
                        int guid = instance.LastIndexOf("#{", StringComparison.Ordinal);
                        if (guid > 0) instance = instance.Substring(0, guid);
                        instance = instance.Replace('#', '\\');
                        uint devInst;
                        // CM_LOCATE_DEVNODE_NORMAL finds a device only while it is present.
                        bool present = Native.CM_Locate_DevNodeW(out devInst, instance, 0) == 0;
                        bool already;
                        ports[port] = present || (ports.TryGetValue(port, out already) && already);
                    }
                }
            }
            return ports;
        }

        private static List<Dictionary<string, object>> Sizes(string printer, string driver)
        {
            string key = printer + "|" + driver;
            List<Dictionary<string, object>> cached;
            if (sizeCache.TryGetValue(key, out cached)) return cached;
            List<Dictionary<string, object>> sizes = new List<Dictionary<string, object>>();
            try
            {
                PrinterSettings settings = new PrinterSettings();
                settings.PrinterName = printer;
                if (settings.IsValid)
                {
                    foreach (PaperSize size in settings.PaperSizes)
                    {
                        Dictionary<string, object> mm = new Dictionary<string, object>();
                        mm["width"] = Math.Round(size.Width * 0.254, 1);
                        mm["height"] = Math.Round(size.Height * 0.254, 1);
                        Dictionary<string, object> entry = new Dictionary<string, object>();
                        entry["name"] = size.PaperName;
                        entry["mm"] = mm;
                        sizes.Add(entry);
                    }
                }
            }
            catch (Exception)
            {
                // A driver that cannot report its sizes still prints.
            }
            sizeCache[key] = sizes;
            return sizes;
        }

        private static List<Dictionary<string, object>> ListPrinters(bool fresh)
        {
            if (fresh) sizeCache.Clear();
            Dictionary<string, bool> usb = UsbPresence();
            string defaultPrinter = new PrinterSettings().PrinterName;
            List<Dictionary<string, object>> list = new List<Dictionary<string, object>>();
            foreach (PRINTER_INFO_2 info in EnumPrinters())
            {
                List<string> statuses = Names(info.Status, PrinterStatusNames);
                // "Use printer offline", set by a person or by Windows itself.
                if ((info.Attributes & 0x400) != 0 && !statuses.Contains("OFFLINE")) statuses.Add("OFFLINE");
                object connected = null;
                string portName = info.pPortName ?? "";
                foreach (string part in portName.Split(','))
                {
                    bool present;
                    if (usb.TryGetValue(part.Trim(), out present))
                    {
                        connected = present;
                        if (present) break;
                    }
                }
                Dictionary<string, object> printer = new Dictionary<string, object>();
                printer["name"] = info.pPrinterName;
                printer["driver"] = info.pDriverName;
                printer["connection"] = portName;
                printer["default"] = string.Equals(info.pPrinterName, defaultPrinter, StringComparison.OrdinalIgnoreCase);
                printer["network"] = (info.Attributes & 0x10) != 0;
                printer["statuses"] = statuses;
                printer["connected"] = connected;
                printer["jobs"] = info.cJobs;
                printer["sizes"] = Sizes(info.pPrinterName, info.pDriverName);
                list.Add(printer);
            }
            return list;
        }

        private static bool Installed(string printer)
        {
            foreach (PRINTER_INFO_2 info in EnumPrinters())
            {
                if (string.Equals(info.pPrinterName, printer, StringComparison.OrdinalIgnoreCase)) return true;
            }
            return false;
        }

        // ── Printing ──────────────────────────────────────────────────────────

        private static Dictionary<string, object> Print(Dictionary<string, object> body)
        {
            string printer = Text(body, "printer");
            string jobName = Text(body, "jobName");
            string token = Text(body, "token");
            string kind = Text(body, "kind");
            string data = Text(body, "data");
            if (string.IsNullOrEmpty(printer) || string.IsNullOrEmpty(jobName) || string.IsNullOrEmpty(token) ||
                string.IsNullOrEmpty(data) || (kind != "raw" && kind != "image"))
            {
                return Failure(400, "bad_request");
            }
            if (!Installed(printer)) return Failure(404, "printer_missing");

            byte[] bytes = Convert.FromBase64String(data);
            uint jobId = 0;
            if (kind == "raw")
            {
                jobId = PrintRaw(printer, jobName, bytes);
            }
            else
            {
                double widthMm = Number(body, "widthMm", 0);
                double heightMm = Number(body, "heightMm", 0);
                if (widthMm <= 0 || heightMm <= 0) return Failure(400, "bad_request");
                PrintImage(printer, jobName, bytes, widthMm, heightMm, Flag(body, "landscape"),
                    Text(body, "fit") != "actual", Flag(body, "mono"));
            }

            Track track = new Track();
            track.Token = token;
            track.Printer = printer;
            track.JobName = jobName;
            track.JobId = jobId;
            tracks[token] = track;
            Thread watcher = new Thread(delegate () { Watch(track); });
            watcher.IsBackground = true;
            watcher.Start();
            Log("sent " + kind + " (" + bytes.Length + " bytes) to " + printer + " as \"" + jobName + "\"" + (jobId > 0 ? " job " + jobId : ""));

            Dictionary<string, object> result = Ok();
            result["jobId"] = jobId;
            return result;
        }

        /// <summary>Bytes straight to the printer — the label's TSPL — past the driver's rendering.</summary>
        private static uint PrintRaw(string printer, string jobName, byte[] bytes)
        {
            IntPtr handle;
            if (!Native.OpenPrinter(printer, out handle, IntPtr.Zero))
            {
                throw new InvalidOperationException("cannot open printer (" + Marshal.GetLastWin32Error() + ")");
            }
            try
            {
                DOC_INFO_1 info = new DOC_INFO_1();
                info.pDocName = jobName;
                info.pOutputFile = null;
                info.pDatatype = "RAW";
                int jobId = Native.StartDocPrinter(handle, 1, ref info);
                if (jobId <= 0) throw new InvalidOperationException("the queue refused the job (" + Marshal.GetLastWin32Error() + ")");
                try
                {
                    if (!Native.StartPagePrinter(handle)) throw new InvalidOperationException("StartPagePrinter failed (" + Marshal.GetLastWin32Error() + ")");
                    int written;
                    bool ok = Native.WritePrinter(handle, bytes, bytes.Length, out written);
                    Native.EndPagePrinter(handle);
                    if (!ok || written != bytes.Length)
                    {
                        throw new InvalidOperationException("only " + written + " of " + bytes.Length + " bytes reached the queue (" + Marshal.GetLastWin32Error() + ")");
                    }
                }
                finally
                {
                    Native.EndDocPrinter(handle);
                }
                return (uint)jobId;
            }
            finally
            {
                Native.ClosePrinter(handle);
            }
        }

        /// <summary>
        /// A picture through the printer's own driver — the A5 receipt. The page
        /// is the paper size asked for, with no margins of our own; `fitPage`
        /// scales it into what the printer can actually reach instead of letting
        /// the edge be cut, and `!fitPage` prints it 1:1, centred.
        /// </summary>
        private static void PrintImage(string printer, string jobName, byte[] png, double widthMm, double heightMm,
            bool landscape, bool fitPage, bool mono)
        {
            RenderImage(printer, jobName, png, widthMm, heightMm, landscape, fitPage, mono, new StandardPrintController());
        }

        /// <summary>
        /// Draws the page the way PrintImage would, against the printer's real
        /// page settings, into a PNG instead of the queue — nothing is printed.
        /// For checking the A5 layout on a driver without wasting paper.
        /// </summary>
        public static string Preview(string printer, string pngPath, double widthMm, double heightMm, bool landscape,
            bool fitPage, bool mono, string outPath)
        {
            PreviewPrintController controller = new PreviewPrintController();
            RenderImage(printer, "preview", File.ReadAllBytes(pngPath), widthMm, heightMm, landscape, fitPage, mono, controller);
            PreviewPageInfo[] pages = controller.GetPreviewPageInfo();
            pages[0].Image.Save(outPath, System.Drawing.Imaging.ImageFormat.Png);
            return lastGeometry + " | " + pages.Length + " page(s), physical " + pages[0].PhysicalSize.Width + "x" + pages[0].PhysicalSize.Height + " (1/100 in)";
        }

        private static string lastGeometry = "";

        private static void RenderImage(string printer, string jobName, byte[] png, double widthMm, double heightMm,
            bool landscape, bool fitPage, bool mono, PrintController controller)
        {
            using (MemoryStream stream = new MemoryStream(png))
            using (Image image = Image.FromStream(stream))
            using (PrintDocument document = new PrintDocument())
            {
                document.PrinterSettings.PrinterName = printer;
                if (!document.PrinterSettings.IsValid) throw new InvalidOperationException("printer_missing");
                document.DocumentName = jobName;
                document.PrintController = controller;

                // The paper exactly as asked, in hundredths of an inch: A5 comes
                // as 148 x 210 with landscape set, the way every driver defines
                // A5; a label comes as 57 x 39 and must not be turned on its side.
                int paperWidth = (int)Math.Round(widthMm / 0.254);
                int paperHeight = (int)Math.Round(heightMm / 0.254);
                PaperSize chosen = null;
                foreach (PaperSize size in document.PrinterSettings.PaperSizes)
                {
                    if (Math.Abs(size.Width - paperWidth) <= 8 && Math.Abs(size.Height - paperHeight) <= 8)
                    {
                        chosen = size;
                        break;
                    }
                }
                document.DefaultPageSettings.PaperSize = chosen ?? new PaperSize("Al-Esnad", paperWidth, paperHeight);
                document.DefaultPageSettings.Landscape = landscape;
                document.DefaultPageSettings.Margins = new Margins(0, 0, 0, 0);
                document.OriginAtMargins = false;

                double pageWidth = landscape ? paperHeight : paperWidth;
                double pageHeight = landscape ? paperWidth : paperHeight;
                document.PrintPage += delegate (object sender, PrintPageEventArgs e)
                {
                    Graphics g = e.Graphics;
                    g.InterpolationMode = mono ? InterpolationMode.NearestNeighbor : InterpolationMode.HighQualityBicubic;
                    g.PixelOffsetMode = PixelOffsetMode.Half;
                    g.SmoothingMode = mono ? SmoothingMode.None : SmoothingMode.HighQuality;
                    g.PageUnit = GraphicsUnit.Display; // hundredths of an inch
                    /*
                     * ⚠️ Measured on the PDF driver: PageBounds turns with the
                     * orientation (827 x 583 for A5 landscape) but PrintableArea
                     * and the hard margins stay PORTRAIT, and VisibleClipBounds is
                     * not the page at all (850 x 1100, a Letter sheet) — placing
                     * the picture by the clip put the receipt half way down the
                     * page and off its foot. So: the paper from PageBounds, the
                     * printable area from PrintableArea with its sides swapped in
                     * landscape, and the origin, which is at the printable area's
                     * corner, moved back by the hard margins.
                     */
                    RectangleF printable = e.PageSettings.PrintableArea;
                    double marginX = landscape ? printable.Y : printable.X;
                    double marginY = landscape ? printable.X : printable.Y;
                    double areaWidth = landscape ? printable.Height : printable.Width;
                    double areaHeight = landscape ? printable.Width : printable.Height;
                    if (areaWidth <= 0 || areaHeight <= 0)
                    {
                        areaWidth = pageWidth;
                        areaHeight = pageHeight;
                    }
                    lastGeometry = string.Format(System.Globalization.CultureInfo.InvariantCulture,
                        "page={0}x{1} printable={2}x{3} at {4},{5} landscape={6}",
                        pageWidth, pageHeight, areaWidth, areaHeight, marginX, marginY, landscape);
                    double width = pageWidth, height = pageHeight, x, y;
                    if (fitPage)
                    {
                        // Whatever the printer can reach, never larger than 1:1.
                        double scale = Math.Min(1.0, Math.Min(areaWidth / pageWidth, areaHeight / pageHeight));
                        width = pageWidth * scale;
                        height = pageHeight * scale;
                        x = (areaWidth - width) / 2;
                        y = (areaHeight - height) / 2;
                    }
                    else
                    {
                        // 1:1 on the paper itself; the origin is the printable corner.
                        x = -marginX;
                        y = -marginY;
                    }
                    g.DrawImage(image, (float)x, (float)y, (float)width, (float)height);
                    e.HasMorePages = false;
                };
                document.Print();
            }
        }

        // ── The queue's word on a job ─────────────────────────────────────────

        private static List<JOB_INFO_1> Jobs(string printer)
        {
            List<JOB_INFO_1> list = new List<JOB_INFO_1>();
            IntPtr handle;
            if (!Native.OpenPrinter(printer, out handle, IntPtr.Zero)) return list;
            try
            {
                uint needed, returned;
                Native.EnumJobs(handle, 0, 999, 1, IntPtr.Zero, 0, out needed, out returned);
                if (needed == 0) return list;
                IntPtr buffer = Marshal.AllocHGlobal((int)needed);
                try
                {
                    if (!Native.EnumJobs(handle, 0, 999, 1, buffer, needed, out needed, out returned)) return list;
                    int size = Marshal.SizeOf(typeof(JOB_INFO_1));
                    for (int index = 0; index < returned; index++)
                    {
                        IntPtr item = new IntPtr(buffer.ToInt64() + index * size);
                        list.Add((JOB_INFO_1)Marshal.PtrToStructure(item, typeof(JOB_INFO_1)));
                    }
                }
                finally
                {
                    Marshal.FreeHGlobal(buffer);
                }
            }
            finally
            {
                Native.ClosePrinter(handle);
            }
            return list;
        }

        /// <summary>
        /// Watches one job until it leaves the queue. Polled here, every 120 ms,
        /// rather than by the page, so a label that prints in half a second is
        /// still seen PRINTING — a page asking twice a second would miss it.
        /// </summary>
        private static void Watch(Track track)
        {
            string mark = track.Token;
            while (true)
            {
                Thread.Sleep(120);
                JOB_INFO_1? match = null;
                foreach (JOB_INFO_1 job in Jobs(track.Printer))
                {
                    if ((track.JobId > 0 && job.JobId == track.JobId) ||
                        (track.JobId == 0 && job.pDocument != null && job.pDocument.IndexOf(mark, StringComparison.Ordinal) >= 0))
                    {
                        match = job;
                        break;
                    }
                }
                double elapsed = (DateTime.UtcNow - track.Started).TotalSeconds;
                lock (track.Gate)
                {
                    if (match.HasValue)
                    {
                        JOB_INFO_1 job = match.Value;
                        track.EverSeen = true;
                        if (track.JobId == 0) track.JobId = job.JobId;
                        List<string> now = Names(job.Status, JobStatusNames);
                        if (now.Count == 0) now.Add("SPOOLING");
                        foreach (string status in now)
                        {
                            if (!track.Seen.Contains(status)) track.Seen.Add(status);
                        }
                        track.Current = now;
                    }
                    else if (track.EverSeen || elapsed > 5)
                    {
                        track.Gone = true;
                        track.Current = new List<string>();
                        return;
                    }
                    if (elapsed > 600)
                    {
                        track.TimedOut = true;
                        return;
                    }
                }
            }
        }

        private static Dictionary<string, object> JobState(string token)
        {
            Track track;
            if (string.IsNullOrEmpty(token) || !tracks.TryGetValue(token, out track)) return Failure(404, "unknown_job");
            Dictionary<string, object> result = Ok();
            lock (track.Gate)
            {
                result["printer"] = track.Printer;
                result["jobId"] = track.JobId;
                result["everSeen"] = track.EverSeen;
                result["gone"] = track.Gone;
                result["timedOut"] = track.TimedOut;
                result["seen"] = new List<string>(track.Seen);
                result["current"] = new List<string>(track.Current);
            }
            return result;
        }

        private static Dictionary<string, object> Cancel(Dictionary<string, object> body)
        {
            string printer = Text(body, "printer");
            uint jobId = (uint)Number(body, "jobId", 0);
            if (string.IsNullOrEmpty(printer) || jobId == 0) return Failure(400, "bad_request");
            IntPtr handle;
            if (!Native.OpenPrinter(printer, out handle, IntPtr.Zero)) return Failure(404, "printer_missing");
            try
            {
                if (!Native.SetJob(handle, jobId, 0, IntPtr.Zero, Native.JOB_CONTROL_DELETE))
                {
                    return Failure(409, "cancel_failed_" + Marshal.GetLastWin32Error());
                }
            }
            finally
            {
                Native.ClosePrinter(handle);
            }
            Log("removed job " + jobId + " from " + printer);
            return Ok();
        }

        // ── Log ───────────────────────────────────────────────────────────────

        public static void Log(string message)
        {
            string line = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + message;
            Console.WriteLine(line);
            if (string.IsNullOrEmpty(logPath)) return;
            lock (logGate)
            {
                try
                {
                    FileInfo file = new FileInfo(logPath);
                    // Kept small: a year of a shop's printing, not a forensic record.
                    if (file.Exists && file.Length > 1024 * 1024)
                    {
                        File.Copy(logPath, logPath + ".1", true);
                        File.WriteAllText(logPath, "");
                    }
                    File.AppendAllText(logPath, line + Environment.NewLine);
                }
                catch (Exception)
                {
                    // The log never stops a print.
                }
            }
        }
    }
}
