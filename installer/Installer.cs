// Multi Chat Hub installer. Copies the dock's files and adds one entry to OBS's
// Custom Browser Docks, then exits. Nothing stays running and nothing is downloaded.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using System.Windows.Forms;

[assembly: AssemblyTitle("Multi Chat Hub Setup")]
[assembly: AssemblyProduct("Multi Chat Hub")]
[assembly: AssemblyDescription("Installs the Multi Chat Hub dock for OBS")]

static class Core
{
    const string Prefix = "app/";
    public const string Key = "ExtraBrowserDocks=";
    public static string Target = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), @"obs-studio\plugins\MultiChatHub");
    public static string Config = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "obs-studio");
    public static bool SkipObsCheck = false; // set only with /config, for testing

    public static string Url { get { return "file:///" + Uri.EscapeUriString(Path.Combine(Target, "dock.html").Replace('\\', '/')); } }
    public static bool ObsOpen { get { return !SkipObsCheck && Process.GetProcessesByName("obs64").Length > 0; } }
    public static bool Installed { get { return File.Exists(Path.Combine(Target, "dock.html")); } }
    public static string Version { get { var v = Assembly.GetExecutingAssembly().GetName().Version; return v.Major + "." + v.Minor + "." + v.Build; } }

    static IEnumerable<string> Files()
    {
        foreach (var n in Assembly.GetExecutingAssembly().GetManifestResourceNames())
            if (n.StartsWith(Prefix)) yield return n;
    }

    // OBS 31 and newer keep docks in user.ini, older versions in global.ini.
    static string Ini()
    {
        foreach (var n in new[] { "user.ini", "global.ini" })
        {
            var p = Path.Combine(Config, n);
            if (File.Exists(p)) return p;
        }
        return null;
    }

    public static void CopyFiles()
    {
        foreach (var n in Files())
        {
            var to = Path.Combine(Target, n.Substring(Prefix.Length).Replace('/', '\\'));
            Directory.CreateDirectory(Path.GetDirectoryName(to));
            using (var s = Assembly.GetExecutingAssembly().GetManifestResourceStream(n))
            using (var f = File.Create(to)) s.CopyTo(f);
        }
    }

    // Removes only files this installer put there, then folders that are empty.
    public static void RemoveFiles()
    {
        var dirs = new HashSet<string>();
        foreach (var n in Files())
        {
            var p = Path.Combine(Target, n.Substring(Prefix.Length).Replace('/', '\\'));
            if (File.Exists(p)) File.Delete(p);
            dirs.Add(Path.GetDirectoryName(p));
        }
        if (File.Exists(AutoConnect.File_)) File.Delete(AutoConnect.File_);
        dirs.Add(Target);
        var list = new List<string>(dirs);
        list.Sort((a, b) => b.Length - a.Length);
        foreach (var d in list)
            if (Directory.Exists(d) && Directory.GetFileSystemEntries(d).Length == 0) Directory.Delete(d);
    }

    // Returns the new line value with our dock added, or the same value if it is already there.
    // key: goes after # in the address, so the dock can unlock the saved OBS connection. Null leaves it as it is.
    public static string AddDock(string json, string url, string key)
    {
        json = json.Trim();
        if (json.Length == 0) json = "[]";
        if (!json.StartsWith("[") || !json.EndsWith("]")) throw new InvalidDataException("OBS's dock list is in a form this installer does not know, so it was left alone.");
        var old = FindDock(json, url);
        if (old.Success)
        {
            if (key == null) return json;
            var changed = new Regex(UrlPattern(url), RegexOptions.IgnoreCase).Replace(old.Value.Replace("\\/", "/"), x => "\"" + url + "#k=" + key + "\"", 1);
            return changed == old.Value ? json : json.Substring(0, old.Index) + changed + json.Substring(old.Index + old.Length);
        }
        var item = "{\"title\": \"Multi Chat Hub\", \"url\": \"" + url + (key == null ? "" : "#k=" + key) + "\", \"uuid\": \"" + Guid.NewGuid().ToString("N") + "\"}";
        var body = json.Substring(1, json.Length - 2).Trim();
        return "[" + (body.Length == 0 ? item : body + ", " + item) + "]";
    }
    public static string RemoveDock(string json, string url)
    {
        var m = FindDock(json, url);
        if (!m.Success) return json;
        var before = json.Substring(0, m.Index).TrimEnd();
        var after = json.Substring(m.Index + m.Length).TrimStart();
        if (after.StartsWith(",")) after = after.Substring(1).TrimStart();
        else if (before.EndsWith(",")) before = before.Substring(0, before.Length - 1);
        else return before + after;
        return before + (before.EndsWith(",") ? " " : "") + after;
    }
    // One dock is one flat object. Quoted text is skipped so braces inside it do not matter.
    static Match FindDock(string json, string url)
    {
        for (var m = Regex.Match(json, "\\{(?:[^{}\"]|\"(?:[^\"\\\\]|\\\\.)*\")*\\}"); m.Success; m = m.NextMatch())
            if (Regex.IsMatch(m.Value.Replace("\\/", "/"), UrlPattern(url), RegexOptions.IgnoreCase)) return m;
        return Match.Empty;
    }
    static string UrlPattern(string url) { return "\"" + Regex.Escape(url) + "(?:#[^\"\\\\]*)?\""; }
    // The key already in OBS's dock list, so an update does not need a new one.
    public static string SavedKey()
    {
        var path = Ini();
        if (path == null) return null;
        var line = Regex.Match(Encoding.UTF8.GetString(File.ReadAllBytes(path)), "(?m)^" + Key + "([^\\r\\n]*)");
        var dock = line.Success ? FindDock(line.Groups[1].Value, Url) : Match.Empty;
        var k = dock.Success ? Regex.Match(dock.Value, "#k=([0-9a-f]{64})\"") : Match.Empty;
        return k.Success ? k.Groups[1].Value : null;
    }

    // Changes only the dock line, and backs the file up first. Returns the backup's name, or null if nothing changed.
    public static string EditIni(bool add, string key)
    {
        var path = Ini();
        if (path == null)
        {
            if (!add) return null;
            throw new FileNotFoundException("OBS's settings were not found. Open OBS once, close it, then run this again.");
        }
        var enc = new UTF8Encoding(false);
        var text = enc.GetString(File.ReadAllBytes(path));
        var nl = text.Contains("\r\n") ? "\r\n" : "\n";
        var m = Regex.Match(text, "(?m)^" + Key + "([^\\r\\n]*)");
        string now;
        if (m.Success)
        {
            var value = add ? AddDock(m.Groups[1].Value, Url, key) : RemoveDock(m.Groups[1].Value, Url);
            if (value == m.Groups[1].Value.Trim()) return null;
            now = text.Substring(0, m.Index) + Key + value + text.Substring(m.Index + m.Length);
        }
        else
        {
            if (!add) return null;
            var sec = Regex.Match(text, "(?m)^\\[BasicWindow\\][^\\r\\n]*(\\r?\\n)?");
            var line = Key + AddDock("[]", Url, key) + nl;
            if (sec.Success) now = text.Insert(sec.Index + sec.Length, (sec.Value.EndsWith("\n") ? "" : nl) + line);
            else now = text + (text.Length == 0 || text.EndsWith("\n") ? "" : nl) + "[BasicWindow]" + nl + line;
        }
        if (ObsOpen) throw new InvalidOperationException("OBS was opened. Close it and try again.");
        var backup = path + ".multi-chat-hub-" + DateTime.Now.ToString("yyyyMMddTHHmmssfff") + ".bak";
        File.Copy(path, backup, false);
        var tmp = path + ".multi-chat-hub.tmp";
        File.WriteAllBytes(tmp, enc.GetBytes(now));
        File.Replace(tmp, path, null);
        return Path.GetFileName(backup);
    }

    public static string Install()
    {
        if (ObsOpen) throw new InvalidOperationException("Close OBS first (check the system tray too), then try again.");
        CopyFiles();
        string note = "", key = null;
        if (AutoConnect.Wanted)
        {
            // The dock still works without this, so a problem here never stops the install.
            try { key = AutoConnect.Prepare(SavedKey()); note = key == null ? "\n\nOBS's connection settings were not found. Open OBS once, close it, and run this again to connect by itself." : "\n\nThe dock will connect to OBS by itself."; }
            catch (Exception e) { key = null; note = "\n\nIt could not set up the OBS connection: " + e.Message; }
        }
        var b = EditIni(true, key);
        return "Installed. Open OBS and tick Docks > Multi Chat Hub if it is not showing." + note + (b == null ? "" : "\n\nOBS's settings were backed up as " + b + ".");
    }
    public static string Uninstall()
    {
        if (ObsOpen) throw new InvalidOperationException("Close OBS first (check the system tray too), then try again.");
        var b = EditIni(false, null);
        RemoveFiles();
        return "Removed." + (b == null ? "" : "\n\nOBS's settings were backed up as " + b + ".");
    }
}

// Lets the dock connect to OBS without anyone copying a password. OBS's own WebSocket
// password is locked (AES-256 + HMAC-SHA256) in connect.js next to the dock. The key that
// opens it is only in OBS's settings, in this Windows user's folder, where the password
// already is. Nothing is sent anywhere.
static class AutoConnect
{
    public static bool Wanted = true;
    public static string File_ { get { return Path.Combine(Core.Target, "connect.js"); } }
    static string ObsFile { get { return Path.Combine(Core.Config, @"plugin_config\obs-websocket\config.json"); } }

    // Returns the key for the dock's address, or null when OBS has no connection settings yet.
    public static string Prepare(string savedKey)
    {
        if (!File.Exists(ObsFile)) return null;
        var text = Encoding.UTF8.GetString(File.ReadAllBytes(ObsFile)).TrimStart('\uFEFF');
        // The reader's own error would repeat the file's contents, password included, so it is not shown.
        Dictionary<string, object> c = null;
        try { c = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(text); } catch (Exception) { }
        if (c == null) throw new InvalidDataException("OBS's connection settings could not be read.");
        int port = c.ContainsKey("server_port") ? Convert.ToInt32(c["server_port"]) : 4455;
        bool auth = !c.ContainsKey("auth_required") || Convert.ToBoolean(c["auth_required"]);
        var password = auth && c.ContainsKey("server_password") ? Convert.ToString(c["server_password"]) : "";
        if (port < 1 || port > 65535) throw new InvalidDataException("OBS's port number is not usable.");
        if (auth && password.Length == 0) throw new InvalidDataException("OBS has no WebSocket password yet. Set one in Tools > WebSocket Server Settings.");
        if (!c.ContainsKey("server_enabled") || !Convert.ToBoolean(c["server_enabled"])) TurnOn(text);

        var key = savedKey == null ? Random(32) : Bytes(savedKey);
        var iv = Random(16);
        byte[] box;
        using (var aes = new AesCryptoServiceProvider { KeySize = 256, Mode = CipherMode.CBC, Padding = PaddingMode.PKCS7, Key = Mac(key, Encoding.ASCII.GetBytes("lock")), IV = iv })
        using (var e = aes.CreateEncryptor())
        {
            var plain = Encoding.UTF8.GetBytes(new JavaScriptSerializer().Serialize(new Dictionary<string, object> { { "port", port }, { "password", password } }));
            box = e.TransformFinalBlock(plain, 0, plain.Length);
        }
        var both = new byte[iv.Length + box.Length];
        iv.CopyTo(both, 0);
        box.CopyTo(both, iv.Length);
        var tag = Mac(Mac(key, Encoding.ASCII.GetBytes("check")), both);
        File.WriteAllText(File_, "window.MCH_CONNECT = { box: '" + Convert.ToBase64String(both) + "', tag: '" + Convert.ToBase64String(tag) + "' };\n", new UTF8Encoding(false));
        return BitConverter.ToString(key).Replace("-", "").ToLowerInvariant();
    }
    // Changes only whether the server is on, and backs the file up first. The password stays on.
    static void TurnOn(string text)
    {
        var now = Regex.Replace(text, "(\"server_enabled\"\\s*:\\s*)false", "$1true");
        if (now == text) throw new InvalidDataException("Turn on Tools > WebSocket Server Settings > Enable WebSocket server in OBS.");
        if (Core.ObsOpen) throw new InvalidOperationException("OBS was opened. Close it and try again.");
        File.Copy(ObsFile, ObsFile + ".multi-chat-hub-" + DateTime.Now.ToString("yyyyMMddTHHmmssfff") + ".bak", false);
        File.WriteAllText(ObsFile, now, new UTF8Encoding(false));
    }
    static byte[] Random(int n) { var b = new byte[n]; using (var r = new RNGCryptoServiceProvider()) r.GetBytes(b); return b; }
    static byte[] Mac(byte[] key, byte[] data) { using (var h = new HMACSHA256(key)) return h.ComputeHash(data); }
    static byte[] Bytes(string hex) { var b = new byte[hex.Length / 2]; for (int i = 0; i < b.Length; i++) b[i] = Convert.ToByte(hex.Substring(i * 2, 2), 16); return b; }
}

// Its own little window, one step at a time: what it does, close OBS, done.
class Setup : Form
{
    static readonly Color Purple = Color.FromArgb(0x5B, 0x2F, 0xC4), Ink = Color.FromArgb(0x1C, 0x1C, 0x1F), Line = Color.FromArgb(0xDD, 0xDD, 0xE3);
    readonly Label head = new Label(), body = new Label();
    readonly RadioButton update = new RadioButton(), uninstall = new RadioButton();
    readonly CheckBox auto = new CheckBox();
    readonly Button back = new Button(), next = new Button();
    readonly Timer watch = new Timer();
    int step = 0;
    bool done = false;
    string result = "";

    Setup()
    {
        Text = "Multi Chat Hub Setup";
        Font = new Font("Segoe UI", 10f);
        AutoScaleMode = AutoScaleMode.Dpi;
        ClientSize = new Size(480, 350);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.White;
        ForeColor = Ink;
        Icon = Icon.ExtractAssociatedIcon(Assembly.GetExecutingAssembly().Location);
        var logo = new PictureBox { SizeMode = PictureBoxSizeMode.Zoom };
        using (var st = Assembly.GetExecutingAssembly().GetManifestResourceStream("logo.png")) logo.Image = new Bitmap(st);
        logo.SetBounds(24, 18, 46, 46);
        var title = new Label { Text = "Multi Chat Hub " + Core.Version, Font = new Font("Segoe UI", 15f, FontStyle.Bold), Location = new Point(82, 26), AutoSize = true };
        head.Font = new Font("Segoe UI", 11f, FontStyle.Bold);
        head.SetBounds(24, 100, 432, 26);
        body.SetBounds(24, 130, 432, 112);
        update.SetBounds(26, 196, 420, 26);
        uninstall.SetBounds(26, 224, 420, 26);
        update.Text = "Update to " + Core.Version;
        uninstall.Text = "Uninstall";
        update.Checked = true;
        auto.Text = "Connect to OBS by itself, with no password to copy";
        auto.Checked = true;
        auto.SetBounds(26, 250, 430, 26);
        auto.CheckedChanged += delegate { AutoConnect.Wanted = auto.Checked; };
        update.CheckedChanged += delegate { Show(step); };
        Style(back, 238, false);
        Style(next, 352, true);
        back.Text = "Back";
        back.Click += delegate { Show(step - 1); };
        next.Click += delegate { Next(); };
        AcceptButton = next;
        watch.Interval = 1000;
        watch.Tick += delegate { if (step == 1) Show(1); };
        Controls.AddRange(new Control[] { logo, title, Rule(82), head, update, uninstall, auto, body, Rule(282), back, next });
        Show(0);
    }
    static void Style(Button b, int x, bool main)
    {
        b.SetBounds(x, 298, 104, 36);
        b.FlatStyle = FlatStyle.Flat;
        b.FlatAppearance.BorderColor = main ? Purple : Line;
        b.EnabledChanged += delegate { Tint(b, main); };
        Tint(b, main);
    }
    static void Tint(Button b, bool main)
    {
        b.BackColor = !main ? Color.White : b.Enabled ? Purple : Color.FromArgb(0xC9, 0xC9, 0xD2);
        b.FlatAppearance.BorderColor = main ? b.BackColor : Line;
        b.ForeColor = main ? Color.White : Ink;
    }
    static Control Rule(int y) { var l = new Label { BackColor = Line }; l.SetBounds(24, y, 432, 1); return l; }

    bool Removing { get { return Core.Installed && uninstall.Checked; } }
    void Show(int to)
    {
        step = to;
        bool choose = step == 0 && Core.Installed;
        update.Visible = uninstall.Visible = choose;
        auto.Visible = step == 0 && !Removing;
        back.Visible = step == 1 || (step == 2 && !done);
        next.Enabled = true;
        if (step == 0)
        {
            head.Text = "A private chat dock for OBS";
            body.Height = choose ? 60 : 116;
            body.Text = choose ? "It is already installed. What would you like to do?"
                : "Nothing shows on stream and nothing runs in the background. Your other docks are not changed.\n\nIt goes here:\n" + Core.Target;
            next.Text = "Next";
        }
        else if (step == 1)
        {
            bool open = Core.ObsOpen;
            body.Height = 130;
            head.Text = open ? "Close OBS" : "Ready";
            body.Text = open ? "OBS is open. Close it to continue. Check the system tray too.\n\nWaiting for OBS to close..."
                : Removing ? "This removes the dock from OBS.\n\nTo remove saved sign-ins too, go Back, open OBS and sign out inside the dock first."
                : "OBS is closed. Your sign-ins and settings are kept." + (auto.Checked ? "\n\nOBS's WebSocket server will be turned on if it is off. Its password stays on and is saved locked, on this PC only." : "");
            next.Text = Removing ? "Uninstall" : Core.Installed ? "Update" : "Install";
            next.Enabled = !open;
        }
        else
        {
            body.Height = 140;
            head.Text = done ? "Done" : "Not done";
            body.Text = result;
            next.Text = "Close";
        }
        watch.Enabled = step == 1;
    }
    void Next()
    {
        if (step == 0) Show(1);
        else if (step == 2) Close();
        else
        {
            try { result = Removing ? Core.Uninstall() : Core.Install(); done = true; }
            catch (UnauthorizedAccessException) { result = "Windows did not allow changes in:\n" + Core.Target + "\n\nRight-click this installer and choose Run as administrator."; }
            catch (Exception e) { result = e.Message; }
            Show(2);
        }
    }

    // Developer options: /install or /uninstall with no window, /target:folder, /config:folder, /noconnect
    [STAThread]
    static int Main(string[] args)
    {
        string run = null;
        foreach (var a in args)
        {
            if (a.StartsWith("/target:")) Core.Target = Path.GetFullPath(a.Substring(8));
            else if (a.StartsWith("/config:")) { Core.Config = Path.GetFullPath(a.Substring(8)); Core.SkipObsCheck = true; }
            else if (a == "/noconnect") AutoConnect.Wanted = false;
            else if (a == "/install" || a == "/uninstall") run = a;
        }
        if (run != null)
        {
            try { Console.WriteLine(run == "/install" ? Core.Install() : Core.Uninstall()); return 0; }
            catch (Exception e) { Console.WriteLine("FAILED: " + e.Message); return 1; }
        }
        Application.EnableVisualStyles();
        Application.Run(new Setup());
        return 0;
    }
}
