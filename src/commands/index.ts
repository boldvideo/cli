import type { Command } from "../spec";
import { api } from "./api";
import { ask } from "./ask";
import { collections } from "./collections";
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
	collections,
	ask,
	search,
	api,
];
