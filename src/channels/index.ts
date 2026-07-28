// Channel self-registration barrel file.
// Each import triggers the channel module's registerChannel() call.
// Channels self-register on import; the orchestrator iterates them via
// getRegisteredChannelNames() / getChannelFactory() from ./registry.js.
// There is no group setup — all channels deliver to OWNER_JID.

// discord

// gmail

// slack
import './slack.js';

// telegram
import './telegram.js';

// whatsapp
import './whatsapp.js';

// web (dashboard direct session — always available)
import './web.js';