// Multi Chat Hub installer. Copies the dock's files and adds one entry to OBS's
// Custom Browser Docks, then exits. Nothing stays running and nothing is downloaded.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
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
        dirs.Add(Target);
        var list = new List<string>(dirs);
        list.Sort((a, b) => b.Length - a.Length);
        foreach (var d in list)
            if (Directory.Exists(d) && Directory.GetFileSystemEntries(d).Length == 0) Directory.Delete(d);
    }

    // Returns the new line value with our dock added, or the same value if it is already there.
    public static string AddDock(string json, string url)
    {
        json = json.Trim();
        if (json.Length == 0) json = "[]";
        if (!json.StartsWith("[") || !json.EndsWith("]")) throw new InvalidDataException("OBS's dock list is in a form this installer does not know, so it was left alone.");
        if (FindDock(json, url).Success) return json;
        var item = "{\"title\": \"Multi Chat Hub\", \"url\": \"" + url + "\", \"uuid\": \"" + Guid.NewGuid().ToString("N") + "\"}";
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
            if (m.Value.Replace("\\/", "/").IndexOf("\"" + url + "\"", StringComparison.OrdinalIgnoreCase) >= 0) return m;
        return Match.Empty;
    }

    // Changes only the dock line, and backs the file up first. Returns the backup's name, or null if nothing changed.
    public static string EditIni(bool add)
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
            var value = add ? AddDock(m.Groups[1].Value, Url) : RemoveDock(m.Groups[1].Value, Url);
            if (value == m.Groups[1].Value.Trim()) return null;
            now = text.Substring(0, m.Index) + Key + value + text.Substring(m.Index + m.Length);
        }
        else
        {
            if (!add) return null;
            var sec = Regex.Match(text, "(?m)^\\[BasicWindow\\][^\\r\\n]*(\\r?\\n)?");
            var line = Key + AddDock("[]", Url) + nl;
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
        var b = EditIni(true);
        return "Installed. Open OBS and tick Docks > Multi Chat Hub if it is not showing." + (b == null ? "" : "\n\nOBS's settings were backed up as " + b + ".");
    }
    public static string Uninstall()
    {
        if (ObsOpen) throw new InvalidOperationException("Close OBS first (check the system tray too), then try again.");
        var b = EditIni(false);
        RemoveFiles();
        return "Removed." + (b == null ? "" : "\n\nOBS's settings were backed up as " + b + ".");
    }
}

// Its own little window, one step at a time: what it does, close OBS, done.
class Setup : Form
{
    static readonly Color Purple = Color.FromArgb(0x5B, 0x2F, 0xC4), Ink = Color.FromArgb(0x1C, 0x1C, 0x1F), Line = Color.FromArgb(0xDD, 0xDD, 0xE3);
    readonly Label head = new Label(), body = new Label();
    readonly RadioButton update = new RadioButton(), uninstall = new RadioButton();
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
        update.CheckedChanged += delegate { Show(step); };
        Style(back, 238, false);
        Style(next, 352, true);
        back.Text = "Back";
        back.Click += delegate { Show(step - 1); };
        next.Click += delegate { Next(); };
        AcceptButton = next;
        watch.Interval = 1000;
        watch.Tick += delegate { if (step == 1) Show(1); };
        Controls.AddRange(new Control[] { logo, title, Rule(82), head, update, uninstall, body, Rule(282), back, next });
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
        back.Visible = step == 1 || (step == 2 && !done);
        next.Enabled = true;
        if (step == 0)
        {
            head.Text = "A private chat dock for OBS";
            body.Height = choose ? 60 : 130;
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
                : "OBS is closed. Your sign-ins and settings are kept.";
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

    // Developer options: /install or /uninstall with no window, /target:folder, /config:folder
    [STAThread]
    static int Main(string[] args)
    {
        string run = null;
        foreach (var a in args)
        {
            if (a.StartsWith("/target:")) Core.Target = Path.GetFullPath(a.Substring(8));
            else if (a.StartsWith("/config:")) { Core.Config = Path.GetFullPath(a.Substring(8)); Core.SkipObsCheck = true; }
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
