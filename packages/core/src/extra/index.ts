export function test() {
    console.log('A')
    return function (
        target: any,
        propertyKey: string,
        descriptor: PropertyDescriptor
    ) {
        console.log('B')
    };
}