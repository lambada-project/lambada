export function replaceAll(input: string, search: string, replace: string) {
    return input.split(search).join(replace);
}

const replaceList: {
    [key: string]: string
} = {
    "/": "-",
    "{": "",
    "}": "",
    ":": "",
    "--": "-"
}


export function getNameFromPath(path: string) {
    path = path.startsWith('/') ? path.substr(1) : path

    for (const item of Object.keys(replaceList)) {
        path = replaceAll(path, item, replaceList[item])
    }

    return replaceAll(replaceAll(replaceAll(path, "{", ""), "}", ""), "/", "-");
}
