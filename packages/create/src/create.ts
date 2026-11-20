import * as path from 'path'
import * as fs from 'fs-extra';
import { spawn } from 'child_process';
import * as replace from 'replace-in-file'

/** Entries a fresh directory may already hold. */
const IGNORED_ENTRIES = new Set(['.git', '.DS_Store'])

export async function create(
  name: string,
  template: string,
  dir: { baseDir: string; newDir: boolean }
) {
  const source = path.resolve(__dirname, './templates', template)
  let destPath: string;

  if (dir.newDir) {
    destPath = path.join(dir.baseDir, name);
    if (fs.existsSync(destPath)) {
      console.error(`${destPath} already exists. Choose another name, or run the initializer inside it.`)
      process.exit(1)
    }
    fs.mkdirSync(destPath);
  } else {
    destPath = dir.baseDir;
    const existing = fs.readdirSync(destPath).filter(entry => !IGNORED_ENTRIES.has(entry))
    if (existing.length > 0) {
      console.error(`${destPath} is not empty (${existing.slice(0, 5).join(', ')}${existing.length > 5 ? ', …' : ''}).`)
      console.error('Run the initializer in an empty directory, or give it a name to create one: npm init @lambada my-app')
      process.exit(1)
    }
  }

  console.info(`Creating ${name} in ${destPath}\n`)

  fs.copySync(source, destPath, {
    dereference: true
  });

  const packagePath = path.resolve(destPath, 'package.json');
  const pckg = JSON.parse(fs.readFileSync(packagePath).toString());
  pckg['name'] = name;
  fs.writeFileSync(packagePath, JSON.stringify(pckg, undefined, 2) + '\n');

  // npm drops a package's .gitignore files when it publishes, so the template carries it under another name.
  fs.moveSync(path.resolve(destPath, 'ignoregit'), path.resolve(destPath, '.gitignore'), { overwrite: true })

  try {
    replace.sync({
      files: [`${destPath}/**/*`, `${destPath}/*`, `${destPath}/.devcontainer/*`],
      from: /{{PROJECT_NAME}}/g,
      to: name,
    });
  }
  catch (error) {
    console.error('Could not set the project name: search for {{PROJECT_NAME}} and replace it.');
  }

  const gitInit = spawn("git", ["init", "--quiet"], {
    cwd: destPath, stdio: 'inherit'
  })

  gitInit.on("close", function () {
    console.info('Installing dependencies…\n');

    const npmI = spawn(
      /^win/.test(process.platform) ? 'npm.cmd' : 'npm',
      ['install', '--no-audit', '--no-fund', '--loglevel=error'],
      { cwd: destPath, stdio: 'inherit', shell: /^win/.test(process.platform) }
    );
    npmI.on('close', function (code) {
      if (code !== 0) {
        console.error(`\nnpm install failed (exit code ${code}). Run it again in ${destPath}.`)
        return
      }
      const relative = path.relative(process.cwd(), destPath) || '.'
      console.info(`\n${name} is ready. Next steps:\n`)
      if (relative !== '.') console.info(`  cd ${relative}`)
      console.info('  code .                 # then "Reopen in Container" (Dev Containers extension)')
      console.info('  npm test               # runs the tests against AWS Emulator')
      console.info('  pulumi stack init dev  # then: pulumi up')
      console.info('\nDocs: https://lambada-project.github.io/quickstart\n')
    });
  })
}
