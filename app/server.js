import { createApp } from "./app.js";

const port = Number.parseInt(process.env.PORT || "3000", 10);

createApp().listen(port, "0.0.0.0", () => {
  console.log(`Express request inspector listening on 0.0.0.0:${port}`);
});
