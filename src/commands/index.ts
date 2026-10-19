import type { Command } from "../spec";
import { ask } from "./ask";
import { help } from "./help";
import { login } from "./login";
import { logout, profiles } from "./profiles";
import { search } from "./search";
import { whoami } from "./whoami";

export const commands: Command[] = [
	help,
	login,
	whoami,
	profiles,
	logout,
	ask,
	search,
];
