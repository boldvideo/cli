import type { Command } from "../spec";
import { api } from "./api";
import { ask } from "./ask";
import { collections } from "./collections";
import { docs } from "./docs";
import { help } from "./help";
import { imports } from "./import";
import { insights } from "./insights";
import { login } from "./login";
import { logout, profiles } from "./profiles";
import { search } from "./search";
import { videos } from "./videos";
import { viewers } from "./viewers";
import { whoami } from "./whoami";

export const commands: Command[] = [
	help,
	login,
	whoami,
	profiles,
	logout,
	imports,
	videos,
	collections,
	viewers,
	ask,
	search,
	insights,
	api,
	docs,
];
