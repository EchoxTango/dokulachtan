// E2E běží mimo React Native (tsx/esbuild): `react-native` je Flow zdroják,
// který esbuild nepřečte. Pro e2e stačí Platform.OS — obřad podpisu ho používá
// jen do metadat (`app.platform`), hodnota v e2e nehraje roli.
export const Platform = { OS: 'android' as const };
