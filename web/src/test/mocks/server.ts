/** @author Tang Chee Seng (with assistance from Claude) */

import { setupServer } from "msw/node";
import { handlers } from "./handlers";

export const server = setupServer(...handlers);