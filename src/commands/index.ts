import type { Command } from "../spec";
import { help } from "./help";
import { upgrade } from "./upgrade";

export const commands: Command[] = [help, upgrade];
