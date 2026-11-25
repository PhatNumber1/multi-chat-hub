// The Twitch Client ID is public (it is not a password), so it is safe to ship.
// Register the app as client type "Public": no client secret exists or is needed.
// Leave blank and the dock asks for one in Settings.
window.MCH = { version: '0.4.0', twitchClientId: '' };
