// Markdown that ships inside the CLI is imported as text and bundled by the build.
declare module "*.md" {
	const text: string;
	export default text;
}
