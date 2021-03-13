export function replaceAll(input: string, search: string, replace: string) {
    return input.split(search).join(replace);
}

export function getNameFromPath(path: string) {
    return replaceAll(replaceAll(replaceAll(path.startsWith('/') ? path.substr(1) : path, "{", ""), "}", ""), "/", "-");
}
