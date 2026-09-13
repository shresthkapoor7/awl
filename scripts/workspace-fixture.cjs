const { app } = require("electron");
app.setPath("userData", process.env.AWL_TEST_USER_DATA);
require("../electron/main.cjs");
