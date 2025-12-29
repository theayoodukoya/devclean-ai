declare module 'gradient-string' {
	const gradient: (...colors: string[]) => (text: string) => string;
	export default gradient;
}
