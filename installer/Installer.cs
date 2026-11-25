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

class Setup : Form
{
    readonly Label status = new Label();
    readonly Button install = new Button(), remove = new Button();

    Setup()
    {
        Text = "Multi Chat Hub Setup";
        Font = new Font("Segoe UI", 10f);
        AutoScaleMode = AutoScaleMode.Dpi;
        ClientSize = new Size(440, 270);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(22, 23, 27);
        ForeColor = Color.FromArgb(232, 233, 236);
        var title = new Label { Text = "Multi Chat Hub " + Core.Version, Font = new Font("Segoe UI", 15f, FontStyle.Bold), Location = new Point(20, 16), AutoSize = true };
        status.SetBounds(22, 60, 396, 140);
        status.Text = "Adds a private chat dock to OBS. Nothing runs in the background and nothing shows on stream." +
            "\n\nClose OBS before you start. Your other docks are not changed.\n\nInstalls to:\n" + Core.Target;
        install.Text = Core.Installed ? "Update" : "Install";
        install.SetBounds(298, 218, 120, 36);
        remove.Text = "Uninstall";
        remove.SetBounds(168, 218, 120, 36);
        remove.Enabled = Core.Installed;
        foreach (var b in new[] { install, remove })
        {
            b.FlatStyle = FlatStyle.Flat;
            b.BackColor = b == install ? Color.FromArgb(122, 53, 224) : Color.FromArgb(50, 53, 61);
            Controls.Add(b);
        }
        Controls.Add(title);
        Controls.Add(status);
        AcceptButton = install;
        install.Click += delegate { Do(Core.Install); };
        remove.Click += delegate
        {
            if (MessageBox.Show(this, "Remove Multi Chat Hub from OBS?\n\nTo remove saved sign-ins too, sign out inside the dock first.", Text, MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2) == DialogResult.Yes) Do(Core.Uninstall);
        };
    }

    void Do(Func<string> work)
    {
        try { status.Text = work(); }
        catch (UnauthorizedAccessException) { status.Text = "Windows did not allow changes in:\n" + Core.Target + "\n\nRight-click this installer and choose Run as administrator."; }
        catch (Exception e) { status.Text = e.Message; }
        install.Text = Core.Installed ? "Update" : "Install";
        remove.Enabled = Core.Installed;
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
