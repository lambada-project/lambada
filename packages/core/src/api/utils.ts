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
    if (typeof path !== 'string') {
        throw new Error('getNameFromPath argument "path" must be a string')
    }

    const regexp = new RegExp(`(^[\/])|${Object.keys(replaceList).join('|')}`, 'g')

    return path.replace(regexp, (dict, initSlash) => initSlash ? '' : replaceList[dict])
}
