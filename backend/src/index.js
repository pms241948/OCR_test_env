const { app } = require("./app");
const { env } = require("./utils/env");

app.listen(env.port, () => {
  console.log(`[backend] listening on port ${env.port}`);
});
