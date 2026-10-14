///////////
// Enums //
///////////

// Game Modes
const GAME_MODE_RANKED = Symbol('GAME_MODE_RANKED');
const GAME_MODE_CASUAL = Symbol('GAME_MODE_CASUAL');

// Available Menus
const MENU_MAIN = Symbol('MENU_MAIN');
const MENU_PAUSE = Symbol('MENU_PAUSE');
const MENU_SCORE = Symbol('MENU_SCORE');



//////////////////
// Global State //
//////////////////

const state = {
	game: {
		mode: GAME_MODE_RANKED,
		// Run time of current game.
		time: 0,
		// Player score.
		score: 0,
		// Total number of cubes smashed in game.
		cubeCount: 0
	},
	menus: {
		// Set to `null` to hide all menus
		active: MENU_MAIN
	}
};


////////////////////////////
// Global State Selectors //
////////////////////////////

const isInGame = () => !state.menus.active;
const isMenuVisible = () => !!state.menus.active;
const isCasualGame = () => state.game.mode === GAME_MODE_CASUAL;
const isPaused = () => state.menus.active === MENU_PAUSE;


///////////////////
// Local Storage //
///////////////////

const highScoreKey = 'tessera-menja-best-v1';
const getHighScore = () => {
	try { const n = Number(localStorage.getItem(highScoreKey)); return Number.isSafeInteger(n) && n >= 0 ? n : 0; } catch { return 0; }
};

let _lastHighscore = getHighScore();
const setHighScore = score => {
	_lastHighscore = getHighScore();
	try { localStorage.setItem(highScoreKey, String(Math.max(getHighScore(), score))); } catch {}
};

const isNewHighScore = () => state.game.score > _lastHighscore;
