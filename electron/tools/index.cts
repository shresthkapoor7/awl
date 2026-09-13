import { askUser } from "./ask-user.cjs";
import { taskComplete } from "./task-complete.cjs";
import { chatName } from "./chat-name.cjs";
import { browserStart } from "./browser-start.cjs";
import { browserTabs } from "./browser-tabs.cjs";
import { browserScreenshot } from "./browser-screenshot.cjs";
import { browserDom } from "./browser-dom.cjs";
import { browserAction } from "./browser-action.cjs";
import { browserWait } from "./browser-wait.cjs";
import { capabilityWrite } from "./capability-write.cjs";
import { capabilityRead } from "./capability-read.cjs";
export const tools = [
  askUser,
  taskComplete,
  chatName,
  browserStart,
  browserTabs,
  browserScreenshot,
  browserDom,
  browserAction,
  browserWait,
  capabilityWrite,
  capabilityRead,
];
