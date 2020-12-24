import mri from "mri";
import * as path from 'path'
import * as fs from 'fs-extra';
import { spawn } from 'child_process';
import * as replace from 'replace-in-file'


export async function create(
  name: string,
  template: string,
  dir: { baseDir: string; newDir: boolean }
) {
  console.log(name, dir.baseDir, dir.newDir);


  const source = path.resolve(__dirname, './templates', template)
  let destPath: string;

  if (dir.newDir) {
    destPath = path.join(dir.baseDir, path.sep, name);
    fs.mkdirSync(destPath);
  } else {
    destPath = dir.baseDir;
  }

  fs.copySync(source, destPath, {
    dereference: true
  });


  const packagePath = path.resolve(destPath, 'package.json');
  let pckg: any = fs.readFileSync(packagePath).toString();
  pckg = JSON.parse(pckg);
  pckg['name'] = name;
  //TODO: replace PROECTNAME in more places
  fs.writeFileSync(packagePath, JSON.stringify(pckg, undefined, 2));

  const indexPath = path.resolve(destPath, 'src/index.ts');
  let indexContent: any = fs.readFileSync(indexPath).toString();

  //TODO: replace PROECTNAME in more places
  fs.writeFileSync(indexPath, indexContent);


  //FFS
  const ignoregitPath = path.resolve(destPath, 'ignoregit');
  const gitignorePath = path.resolve(destPath, '.gitignore');
  fs.moveSync(ignoregitPath, gitignorePath)


  const gitInit = spawn("git", ["init"], {
    cwd: destPath, stdio: 'inherit'
  })

  //spawn("sed", ["-i","s/{{PROJECT_NAME}}/new/g", "file.txt"])

  gitInit.on("close", function (code) {

    try {
      const options = {
        files: [`${destPath}/**/*`, `${destPath}/*`],
        from: /{{PROJECT_NAME}}/g,
        to: 'bar',
      };
      replace.sync(options);
      console.log('Project name set');
    }
    catch (error) {
      console.error('Could not set project name, please search for {{PROJECT_NAME}} and replace it manually');
    }


    console.info('Installing dependencies, please wait...\n');

    const npmI = spawn(
      /^win/.test(process.platform) ? 'npm.cmd' : 'npm',
      ['install'],
      { cwd: destPath, stdio: 'inherit' }
    );
    npmI.on('close', function (code) {
      console.info('Installed all dependencies\n')
      console.info('Next steps:\n')
      console.warn('Install the VSCode extension: ms-vscode-remote.vscode-remote-extensionpack')
      console.warn('Open the root of the project and click on "Reopen in Container"')
      console.warn('If using aws credentials file, check the profile name in the Dockerfile')
    });
  })

}