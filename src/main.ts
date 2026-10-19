#!/usr/bin/env node
import { cli } from "./cli";
import { writeError } from "./errors";

try {
	await cli(process.argv.slice(2));
} catch (cause) {
	process.exitCode = writeError(cause);
}
