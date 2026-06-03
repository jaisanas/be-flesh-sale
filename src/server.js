const app = require("./app");
const redisClient = require("./redis");
const { port } = require("./config");

async function start() {
  try {
    await redisClient.connect();
    app.listen(port, () => {
      console.log(`Server running on port ${port}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

start();
