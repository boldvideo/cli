import { loadProfiles } from "./auth";
import { rootCommand } from "./help";
import {
	type Command,
	type Completion,
	commandFlags,
	defaultSubcommand,
	type Flag,
	findSubcommand,
} from "./spec";

export const shells = ["bash", "zsh", "fish"] as const;
export type Shell = (typeof shells)[number];

export interface Candidate {
	value: string;
	description?: string;
}

export interface Completions {
	candidates: Candidate[];
	/** Let the shell complete file names instead. */
	files: boolean;
}

function profileNames(): Candidate[] {
	try {
		return Object.entries(loadProfiles().profiles).map(([value, profile]) => ({
			value,
			...(profile.name ? { description: profile.name } : {}),
		}));
	} catch {
		return [];
	}
}

function values(spec: { choices?: string[]; complete?: Completion }): {
	candidates: Candidate[];
	files: boolean;
} {
	if (spec.choices)
		return {
			candidates: spec.choices.map((value) => ({ value })),
			files: false,
		};
	if (spec.complete === "profiles")
		return { candidates: profileNames(), files: false };
	return { candidates: [], files: spec.complete === "file" };
}

/**
 * Complete the last word of a command line. `words` is everything after the
 * program name; the last entry is the word under the cursor and may be empty.
 * Only local data is used, so this never waits on the network.
 */
export function complete(words: string[], registry: Command[]): Completions {
	const current = words.at(-1) ?? "";
	let command = rootCommand(registry);
	let pending: Flag | undefined;
	let positionals = 0;
	let literal = false;
	const used = new Set<string>();
	// Before the subcommand is typed, a bare group still accepts its list flags.
	const flagsHere = () => {
		const fallback = defaultSubcommand(command);
		const own = commandFlags(command);
		return fallback
			? [
					...own,
					...commandFlags(fallback).filter(
						(flag) => !own.some((other) => other.name === flag.name),
					),
				]
			: own;
	};
	for (const word of words.slice(0, -1)) {
		if (pending) {
			pending = undefined;
		} else if (literal) {
			positionals++;
		} else if (word === "--") {
			literal = true;
		} else if (word.startsWith("--")) {
			const [name, value] = word.slice(2).split("=", 2);
			const flag = flagsHere().find((flag) => flag.name === name);
			if (flag) used.add(flag.name);
			if (flag && flag.type !== "boolean" && value === undefined)
				pending = flag;
		} else if (word.startsWith("-") && word.length > 1) {
			// In a cluster such as -yn, only the last short flag can take the next word.
			const flag = flagsHere().find((flag) => flag.short === word.at(-1));
			if (flag) used.add(flag.name);
			if (flag && flag.type !== "boolean" && word.length === 2) pending = flag;
		} else if (command.subcommands) {
			const child = findSubcommand(command, word);
			if (!child) return { candidates: [], files: false };
			command = child;
		} else {
			positionals++;
		}
	}

	const matching = (candidates: Candidate[], prefix = "") =>
		candidates
			.filter((candidate) =>
				candidate.value.startsWith(current.slice(prefix.length)),
			)
			.map((candidate) => ({ ...candidate, value: prefix + candidate.value }));

	if (pending) {
		const result = values(pending);
		return { ...result, candidates: matching(result.candidates) };
	}
	if (literal) return { candidates: [], files: false };
	const assignment = /^--([^=]+)=/.exec(current);
	if (assignment) {
		const flag = flagsHere().find((flag) => flag.name === assignment[1]);
		if (!flag || flag.type === "boolean")
			return { candidates: [], files: false };
		const result = values(flag);
		return {
			...result,
			candidates: matching(result.candidates, assignment[0]),
		};
	}
	if (current.startsWith("-"))
		return {
			candidates: matching(
				flagsHere()
					.filter((flag) => flag.type === "list" || !used.has(flag.name))
					.map((flag) => ({
						value: `--${flag.name}`,
						description: flag.description,
					})),
			),
			files: false,
		};
	if (command.subcommands) {
		const named = (pick: (child: Command) => string[]) =>
			matching(
				(command.subcommands ?? []).flatMap((child) =>
					pick(child).map((value) => ({ value, description: child.summary })),
				),
			);
		const names = named((child) => [child.name]);
		// Shorthands stay out of the list until one is the only way to finish the word.
		return {
			candidates: names.length ? names : named((child) => child.aliases ?? []),
			files: false,
		};
	}
	const args = command.args ?? [];
	const arg =
		args[positionals] ?? (args.at(-1)?.variadic ? args.at(-1) : undefined);
	if (!arg) return { candidates: [], files: false };
	const result = values(arg);
	return { ...result, candidates: matching(result.candidates) };
}

/**
 * What the shell scripts read: one `value<TAB>description` per line, and a
 * final `:files` line when the shell should offer file names.
 *
 * Bash splits words at `=` and `:`, so `--privacy=pu` arrives as three words
 * and only the part after the separator may be returned.
 */
export function completionLines(
	shell: Shell,
	words: string[],
	registry: Command[],
): string[] {
	let prefix = "";
	if (shell === "bash") {
		const joined: string[] = [];
		let glue = false;
		for (const word of words) {
			const separator = /^[=:]+$/.test(word);
			if (joined.length && (separator || glue))
				joined[joined.length - 1] += word;
			else joined.push(word);
			glue = separator;
		}
		words = joined;
		const current = words.at(-1) ?? "";
		prefix = current.slice(
			0,
			Math.max(current.lastIndexOf("="), current.lastIndexOf(":")) + 1,
		);
	}
	const { candidates, files } = complete(words, registry);
	const clean = (text: string) => text.replace(/[\t\r\n]+/g, " ");
	return [
		...candidates.map((candidate) => {
			const value = clean(candidate.value.slice(prefix.length));
			return shell !== "bash" && candidate.description
				? `${value}\t${clean(candidate.description)}`
				: value;
		}),
		...(files ? [":files"] : []),
	];
}

const scripts: Record<Shell, string> = {
	bash: `# bash completion for boldvideo and bold
_boldvideo() {
	local cur="\${COMP_WORDS[COMP_CWORD]}" line
	[[ "$cur" == "=" ]] && cur=""
	COMPREPLY=()
	while IFS= read -r line; do
		if [[ "$line" == ":files" ]]; then
			compopt -o filenames 2>/dev/null
			while IFS= read -r line; do COMPREPLY+=("$line"); done < <(compgen -f -- "$cur")
		elif [[ -n "$line" ]]; then
			COMPREPLY+=("$line")
		fi
	done < <("\${COMP_WORDS[0]}" __complete bash -- "\${COMP_WORDS[@]:1:COMP_CWORD}" 2>/dev/null)
}
complete -F _boldvideo boldvideo bold
`,
	zsh: `#compdef boldvideo bold
# zsh completion for boldvideo and bold
_boldvideo() {
	local -a lines described
	local line files=0
	lines=("\${(@f)$("\${words[1]}" __complete zsh -- "\${(@)words[2,CURRENT]}" 2>/dev/null)}")
	for line in $lines; do
		if [[ $line == ":files" ]]; then
			files=1
		elif [[ -n $line ]]; then
			if [[ $line == *$'\\t'* ]]; then
				described+=("\${\${line%%$'\\t'*}//:/\\\\:}:\${line#*$'\\t'}")
			else
				described+=("\${line//:/\\\\:}")
			fi
		fi
	done
	if (( files )); then
		_files
	elif (( \${#described} )); then
		_describe 'boldvideo' described
	fi
}
if [[ $funcstack[1] == _boldvideo ]]; then
	_boldvideo "$@"
else
	compdef _boldvideo boldvideo bold
fi
`,
	fish: `# fish completion for boldvideo and bold
function __boldvideo_complete
	set -l prior (commandline -opc)
	set -l current (commandline -ct)
	for line in ($prior[1] __complete fish -- $prior[2..-1] "$current" 2>/dev/null)
		if test "$line" = ":files"
			__fish_complete_path "$current"
		else
			echo $line
		end
	end
end
complete -c boldvideo -f -a '(__boldvideo_complete)'
complete -c bold -f -a '(__boldvideo_complete)'
`,
};

export function completionScript(shell: Shell): string {
	return scripts[shell];
}
