const path = require('path');

// .env lives at the repo root, shared by backend and database scripts.
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });

const app = require('./app');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Roomie API listening on http://localhost:${PORT}`);
});
