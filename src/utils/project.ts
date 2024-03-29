import fs from 'node:fs';
import path from 'node:path';

import { paramCase } from 'change-case';
import inquirer from 'inquirer';
import mapObject, { mapObjectSkip } from 'map-obj';
import readdirp from 'readdirp';
import recursiveCopy from 'recursive-copy';
import type { PackageJson } from 'type-fest';

import { getTemplateFolderPath } from './paths.js';
import { templateOptions } from './template.js';

interface CreateProjectOptions {
	folder: string;
}

export async function createProject(options?: CreateProjectOptions) {
	const {
		projectType,
		projectName,
		projectDescription,
		projectRepository,
		isLibrary,
	} = await inquirer.prompt<{
		projectType: string;
		projectName: string;
		projectDescription: string;
		projectRepository: string;
		isLibrary: boolean;
	}>([
		{
			type: 'input',
			name: 'projectName',
			message: 'What is the name of your project?',
		},
		{
			type: 'input',
			name: 'projectDescription',
			message: 'What is the description of your project?',
		},
		{
			type: 'input',
			name: 'projectRepository',
			message:
				'What is the repository for this project (e.g. leondreamed/my-repo-name)? (leave blank if none)',
		},
		{
			type: 'list',
			name: 'projectType',
			message: 'What type of project would you like to create?',
			choices: Object.keys(
				mapObject(templateOptions, (key, option) =>
					// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
					option.isDisplayed ? [key, option] : mapObjectSkip
				)
			),
		},
		{
			type: 'confirm',
			name: 'isLibrary',
			message: 'Will you be publishing this project (e.g. onto NPM)?',
		},
	]);

	const destinationFolder =
		options?.folder ?? paramCase(projectName.toLowerCase());
	const projectNameDir = projectName.includes('/')
		? projectName.split('/').at(-1)!
		: projectName;
	const templateOption = projectType as keyof typeof templateOptions;
	const templateSourceFolder = getTemplateFolderPath(
		templateOptions[templateOption]
	);
	fs.mkdirSync(destinationFolder, { recursive: true });

	// @ts-expect-error: bad types
	await recursiveCopy(templateSourceFolder, destinationFolder, {
		dot: true,
		overwrite: true,
	});

	const replaceTemplatesInFile = (filePath: string) => {
		const fileContents = fs.readFileSync(filePath, 'utf8');
		fs.writeFileSync(
			filePath,
			fileContents
				.replace(/{{project_name}}/g, projectName)
				.replace(/{{description}}/g, projectDescription.replace(/"/g, '\\"'))
				.replace(/{{repository}}/g, projectRepository)
		);
	};

	// Loop until all files with {{.*}} have been renamed
	for (;;) {
		let hasFileBeenRenamed = false;
		// eslint-disable-next-line no-await-in-loop
		const files = await readdirp.promise(destinationFolder, {
			type: 'files_directories',
		});

		for (const file of files) {
			if (fs.statSync(file.fullPath).isFile()) {
				replaceTemplatesInFile(file.fullPath);
			}

			if (/{{.*}}/.test(file.fullPath)) {
				const destinationPath = file.fullPath.replaceAll(
					/{{project_name}}/g,
					projectNameDir
				);

				if (fs.statSync(file.fullPath).isFile()) {
					fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
				} else {
					fs.mkdirSync(destinationPath, { recursive: true });
				}

				fs.renameSync(file.fullPath, destinationPath);
				hasFileBeenRenamed = true;
				break;
			}
		}

		if (!hasFileBeenRenamed) {
			break;
		}
	}

	// Rename _gitignore to .gitignore
	fs.renameSync(
		path.join(destinationFolder, '_gitignore'),
		path.join(destinationFolder, '.gitignore')
	);

	// Rename _gitattributes to .gitattributes
	fs.renameSync(
		path.join(destinationFolder, '_gitattributes'),
		path.join(destinationFolder, '.gitattributes')
	);

	const packageJsonPath = path.join(destinationFolder, 'packages', projectNameDir, 'package.json');
	const packageJson = JSON.parse(
		fs.readFileSync(packageJsonPath).toString()
	) as PackageJson;

	if (projectRepository.trim() === '') {
		packageJson.repository = undefined;
	}

	if (isLibrary) {
		packageJson.publishConfig = { directory: 'dist' };
	}

	fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, '\t'));
	fs.writeFileSync(
		path.join(destinationFolder, 'readme.md'),
		`# ${projectName}\n`
	);
}
