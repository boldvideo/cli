import { cli } from "../src/cli";
import { commands } from "../src/commands";
import { writeError } from "../src/errors";
import { fixture } from "./commands";

try {
	await cli(process.argv.slice(2), [...commands, fixture]);
} catch (cause) {
	process.exitCode = writeError(cause);
}
