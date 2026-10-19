import type { Command } from "../spec";
import { help } from "./help";
import { login } from "./login";
import { logout, profiles } from "./profiles";
import { whoami } from "./whoami";

export const commands: Command[] = [help, login, whoami, profiles, logout];
