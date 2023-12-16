import * as Pinpoint from "@aws-sdk/client-pinpoint"

export type MessageRecipient = {
    token: string
    service: 'GCM'
}

export function createMessageRequest(recipient: MessageRecipient, title: string, message: string): Pinpoint.MessageRequest {

    // The action that should occur when the recipient taps the message. Possible
    // values are OPEN_APP (opens the app or brings it to the foreground),
    // DEEP_LINK (opens the app to a specific page or interface), or URL (opens a
    // specific URL in the device's web browser.)
    var action : Pinpoint.Action = 'OPEN_APP';
    // The priority of the push notification. If the value is 'normal', then the
    // delivery of the message is optimized for battery usage on the recipient's
    // device, and could be delayed. If the value is 'high', then the notification is
    // sent immediately, and might wake a sleeping device.
    var priority = 'normal';

    // The amount of time, in seconds, that the push notification service provider
    // (such as FCM or APNS) should attempt to deliver the message before dropping
    // it. Not all providers allow you specify a TTL value.
    var ttl = 30;

    // Boolean that specifies whether the notification is sent as a silent
    // notification (a notification that doesn't display on the recipient's device).
    var silent = false;


    var token = recipient.token;
    var service = recipient.service;


    if (service == 'GCM') {
        return {
            'Addresses': {
                [token]: {
                    'ChannelType': 'GCM'
                }
            },
            'MessageConfiguration': {
                'GCMMessage': {
                    'Action': action,
                    'Body': message,
                    'Priority': priority,
                    'SilentPush': silent,
                    'Title': title,
                    'TimeToLive': ttl,
                    //'Url': url
                }
            }
        };
    } else if (service == 'APNS') {
        return {
            'Addresses': {
                [token]: {
                    'ChannelType': 'APNS'
                }
            },
            'MessageConfiguration': {
                'APNSMessage': {
                    'Action': action,
                    'Body': message,
                    'Priority': priority,
                    'SilentPush': silent,
                    'Title': title,
                    'TimeToLive': ttl,
                    //'Url': url
                }
            }
        };
    } else if (service == 'BAIDU') {
        return {
            'Addresses': {
                [token]: {
                    'ChannelType': 'BAIDU'
                }
            },
            'MessageConfiguration': {
                'BaiduMessage': {
                    'Action': action,
                    'Body': message,
                    'SilentPush': silent,
                    'Title': title,
                    'TimeToLive': ttl,
                    //'Url': url
                }
            }
        };
    } else if (service == 'ADM') {
        return {
            'Addresses': {
                [token]: {
                    'ChannelType': 'ADM'
                }
            },
            'MessageConfiguration': {
                'ADMMessage': {
                    'Action': action,
                    'Body': message,
                    'SilentPush': silent,
                    'Title': title,
                    //'Url': url
                }
            }
        };
    }

    throw 'Invalid Service '  + service
}