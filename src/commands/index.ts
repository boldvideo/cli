import type { Command } from "../spec";
import { help } from "./help";
import { imports } from "./import";
import { login } from "./login";
import { logout, profiles } from "./profiles";
import { videos } from "./videos";
import { whoami } from "./whoami";

export const commands: Command[] = [
	help,
	login,
	whoami,
	profiles,
	logout,
	videos,
	imports,
];
