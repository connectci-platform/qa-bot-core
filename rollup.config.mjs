import babel from '@rollup/plugin-babel';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';
import typescript from '@rollup/plugin-typescript';
import peerDepsExternal from 'rollup-plugin-peer-deps-external';
import postcss from 'rollup-plugin-postcss';
import replace from '@rollup/plugin-replace';
import json from '@rollup/plugin-json';

import { readFileSync } from 'fs';
const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

const config = [
  // ESM and CJS builds for React usage
  {
    input: 'src/lib.tsx',
    output: [
      {
        file: './dist/qa-bot-core.js',
        format: 'esm',
        sourcemap: true,
        exports: 'named',
      },
      {
        file: './dist/qa-bot-core.umd.cjs',
        format: 'cjs',
        sourcemap: true,
        exports: 'named',
      }
    ],
    plugins: [
      peerDepsExternal(),
      json(),
      postcss({
        extensions: ['.css'],
        minimize: true,
        // Extract CSS to a standalone file so consumers that can't execute
        // runtime JS style-injection (e.g. access-ci-ui's shadow DOM wrapper)
        // can import the stylesheet directly:
        //   import '@snf/qa-bot-core/dist/qa-bot-core.css';
        // The standalone build below keeps inject semantics because it's
        // loaded as a plain <script> on HTML pages (e.g. nairr-bot).
        extract: 'qa-bot-core.css',
      }),
      typescript({
        tsconfig: './tsconfig.json',
        declaration: true,
        declarationDir: './dist/types',
        jsx: 'preserve', // Let Babel handle JSX
        // Only process .ts/.tsx — let Babel handle .js/.jsx files to avoid
        // TS5055 "cannot write file" warnings when .js output collides with .js source.
        include: ['src/**/*.ts', 'src/**/*.tsx'],
        // Tests and their helpers aren't part of the published types.
        exclude: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/test-utils/**'],
      }),
      babel({
        babelHelpers: 'bundled',
        exclude: 'node_modules/**',
        presets: ['@babel/preset-env', '@babel/preset-react'],
        extensions: ['.js', '.jsx', '.ts', '.tsx'],
      }),
      resolve({
        extensions: ['.js', '.jsx', '.ts', '.tsx'],
        mainFields: ['module', 'main', 'browser']
      }),
      commonjs(),
      terser(),
    ],
    external: Object.keys(pkg.peerDependencies || {})
  },

  // UMD build with React bundled for standalone use
  {
    input: 'src/standalone.tsx',
    output: {
      file: './dist/qa-bot-core.standalone.js',
      format: 'umd',
      name: 'qaBotCore',
      sourcemap: true,
      exports: 'default',
      globals: {}
    },
    plugins: [
      json(),
      postcss({
        extensions: ['.css'],
        minimize: true,
        inject: {
          insertAt: 'top',
        },
      }),
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false, // Don't generate .d.ts for standalone build
        jsx: 'preserve', // Let Babel handle JSX
      }),
      babel({
        babelHelpers: 'bundled',
        exclude: 'node_modules/**',
        presets: ['@babel/preset-env', '@babel/preset-react'],
        extensions: ['.js', '.jsx', '.ts', '.tsx'],
      }),
      replace({
        preventAssignment: true,
        'process.env.NODE_ENV': JSON.stringify('production'),
        'process.env.REACT_APP_API_KEY': JSON.stringify('demo-key'),
      }),
      resolve({
        extensions: ['.js', '.jsx', '.ts', '.tsx'],
        alias: {
          'react': 'preact/compat',
          'react-dom': 'preact/compat',
          'react-dom/client': 'preact/compat/client'
        },
        mainFields: ['module', 'main', 'browser']
      }),
      commonjs(),
      terser(),
    ],
    // Don't exclude peer dependencies for the standalone build
    external: []
  }
];

export default config;