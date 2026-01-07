import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import terser from "@rollup/plugin-terser";
import typescript from "@rollup/plugin-typescript";
import dts from "rollup-plugin-dts";

const jsPlugins = [
  resolve(),
  commonjs(),
  typescript({ tsconfig: "./tsconfig.json" }),
  terser(),
];

const modernBuild = {
  input: "src/index.ts",
  output: [
    {
      dir: "dist",
      format: "cjs",
      entryFileNames: "[name].cjs.js",
      sourcemap: true,
      sourcemapExcludeSources: true,
      exports: "named",
    },
    {
      dir: "dist",
      format: "esm",
      entryFileNames: "[name].esm.js",
      sourcemap: true,
      sourcemapExcludeSources: true,
    },
  ],
  plugins: jsPlugins,
};

const umdBuild = {
  input: "src/index.ts",
  output: {
    file: "dist/userlens-session-recorder.umd.js",
    format: "umd",
    name: "UserlensSessionRecorder",
    exports: "named",
    sourcemap: true,
    sourcemapExcludeSources: true,
  },
  plugins: jsPlugins,
};

const dtsBuild = {
  input: "src/index.ts",
  output: { file: "dist/types/index.d.ts", format: "es" },
  plugins: [dts()],
};

export default [modernBuild, umdBuild, dtsBuild];
