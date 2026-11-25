// The Twitch Client ID is public (it is not a password), so it is safe to ship.
// Register the app as client type "Public": no client secret exists or is needed.
// Leave blank and the dock asks for one in Settings.
// Kick's own public chat key. Kick replaces it now and then.
window.MCH = { version: '0.7.0', twitchClientId: '', kickChatKey: '34bf7a0ff419a2a775b9' };
