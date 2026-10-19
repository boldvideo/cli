export const exitCodes = [
	{ exit_code: 0, meaning: "Success" },
	{ exit_code: 1, meaning: "General failure" },
	{ exit_code: 2, meaning: "Usage error" },
	{ exit_code: 3, meaning: "Not authenticated or not permitted" },
	{ exit_code: 4, meaning: "Not found" },
	{ exit_code: 5, meaning: "Timed out while waiting" },
] as const;

export type ExitCode = (typeof exitCodes)[number]["exit_code"];
