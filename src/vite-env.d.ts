/// <reference types="vite/client" />

// The .qc harness is imported as a raw string via Vite's ?raw suffix.
declare module "*.qc?raw" {
  const src: string;
  export default src;
}
