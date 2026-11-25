// Shared online leaderboard (optional).
// Leave these empty and the leaderboard is kept on this device/browser only.
// To share one leaderboard between all players, create a free Firebase project with
// a Firestore database, then paste its Project ID and Web API key here (see README.md).
window.CB = window.CB || {};
CB.Config = {
  firebase: {
    projectId: '',
    apiKey: '',
  },
};
