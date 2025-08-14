import { parseServerInfo, parseUrlParams, createTlsConfig, createTransportConfig, decodeBase64, base64ToBinary } from './utils.js';

export class ProxyParser {
    static parse(url, userAgent) {
        url = url.trim();
        let type;
        let decodedUrl = url;

        // 这段代码的逻辑是为了兼容同时支持明文链接和 Base64 编码链接的情况
        try {
            const potentialDecoded = base64ToBinary(url);
            if (potentialDecoded.includes('://')) {
                decodedUrl = potentialDecoded;
            }
        } catch (e) {
            // 如果解码失败，则按原 URL 处理
        }

        type = decodedUrl.split('://')[0];

        switch(type) {
            case 'ss': return new ShadowsocksParser().parse(decodedUrl);
            case 'vmess': return new VmessParser().parse(decodedUrl);
            case 'vless': return new VlessParser().parse(decodedUrl);
            case 'hysteria':
            case 'hysteria2':
            case 'hy2':
                return new Hysteria2Parser().parse(decodedUrl);
            case 'http':
            case 'https':
                // HttpParser 专门处理订阅链接，因此仍然传入原始 URL
                return HttpParser.parse(url, userAgent);
            case 'trojan': return new TrojanParser().parse(decodedUrl);
            case 'tuic': return new TuicParser().parse(decodedUrl);
            case 'socks':
            case 'socks5': return new Socks5Parser().parse(decodedUrl);
            default:
                console.error('Unsupported proxy protocol:', type);
                return null;
        }
    }
}

class Socks5Parser {
    parse(url) {
        try {
            // 使用 URL 对象进行安全解析
            const parsedUrl = new URL(url);
            const server = parsedUrl.hostname;
            const port = parsedUrl.port;
            const tag = parsedUrl.hash ? decodeURIComponent(parsedUrl.hash.substring(1)) : server;

            let username;
            let password;

            // 从原始 URL 字符串中直接提取 userinfo 部分
            // 匹配 socks:// 或 socks5:// 后，@ 符号前的内容
            const userinfoMatch = url.match(/^(?:socks5?:\/\/(.*?)(?=@))/);

            if (userinfoMatch && userinfoMatch[1]) {
                const userinfo = decodeURIComponent(userinfoMatch[1]);

                // 尝试作为明文解析
                const parts = userinfo.split(':');
                if (parts.length > 1) {
                    username = parts[0];
                    password = parts.slice(1).join(':');
                } else {
                    // 如果明文解析失败，再尝试 Base64 解码
                    try {
                        const decodedUserinfo = atob(userinfo);
                        const decodedParts = decodedUserinfo.split(':');
                        username = decodedParts[0];
                        password = decodedParts.length > 1 ? decodedParts.slice(1).join(':') : undefined;
                    } catch (e) {
                        // 如果解码也失败，则整个 userinfo 作为用户名
                        username = userinfo;
                        password = undefined;
                    }
                }
            }

            // 确保 password 存在，如果为 '' 则设置为 undefined
            if (password === '') {
                password = undefined;
            }

            return {
                tag: tag,
                type: 'socks5',
                server: server,
                server_port: parseInt(port),
                username: username,
                password: password,
                network: 'tcp',
                tcp_fast_open: false,
            };
        } catch (e) {
            console.error('Failed to parse socks5 URL:', e);
            return null;
        }
    }
}

class ShadowsocksParser {
    parse(url) {
        let parts = url.replace('ss://', '').split('#');
        let mainPart = parts[0];
        let tag = parts[1];
        if (tag && tag.includes('%')) {
            tag = decodeURIComponent(tag);
        }

        // Try new format first
        try {
            let [base64, serverPart] = mainPart.split('@');
            // If no @ symbol found, try legacy format
            if (!serverPart) {
                // Decode the entire mainPart for legacy format
                let decodedLegacy = base64ToBinary(mainPart);
                // Legacy format: method:password@server:port
                let [methodAndPass, serverInfo] = decodedLegacy.split('@');
                let [method, password] = methodAndPass.split(':');
                let [server, server_port] = this.parseServer(serverInfo);

                return this.createConfig(tag, server, server_port, method, password);
            }

            // Continue with new format parsing
            let decodedParts = base64ToBinary(decodeURIComponent(base64)).split(':');
            let method = decodedParts[0];
            let password = decodedParts.slice(1).join(':');
            let [server, server_port] = this.parseServer(serverPart);

            return this.createConfig(tag, server, server_port, method, password);
        } catch (e) {
            console.error('Failed to parse shadowsocks URL:', e);
            return null;
        }
    }

    // Helper method to parse server info
    parseServer(serverPart) {
        // Match IPv6 address
        let match = serverPart.match(/\[([^\]]+)\]:(\d+)/);
        if (match) {
            return [match[1], match[2]];
        }
        return serverPart.split(':');
    }

    // Helper method to create config object
    createConfig(tag, server, server_port, method, password) {
        return {
            "tag": tag || "Shadowsocks",
            "type": 'shadowsocks',
            "server": server,
            "server_port": parseInt(server_port),
            "method": method,
            "password": password,
            "network": 'tcp',
            "tcp_fast_open": false
        };
    }
}

class VmessParser {
    parse(url) {
        let base64 = url.replace('vmess://', '')
        let vmessConfig = JSON.parse(decodeBase64(base64))
        let tls = { "enabled": false }
        let transport = {}
        if (vmessConfig.net === 'ws') {
            transport = {
                "type": "ws",
                "path": vmessConfig.path,
                "headers": { 'Host': vmessConfig.host? vmessConfig.host : vmessConfig.sni  }
            }
            if (vmessConfig.tls !== '') {
                tls = {
                    "enabled": true,
                    "server_name": vmessConfig.sni,
                    "insecure": false
                }
            }
        }
        return {
            "tag": vmessConfig.ps,
            "type": "vmess",
            "server": vmessConfig.add,
            "server_port": parseInt(vmessConfig.port),
            "uuid": vmessConfig.id,
            "alter_id": parseInt(vmessConfig.aid),
            "security": vmessConfig.scy || "auto",
            "network": "tcp",
            "tcp_fast_open": false,
            "transport": transport,
            "tls": tls.enabled ? tls : undefined
        }
    }
}

class VlessParser {
    parse(url) {
        const { addressPart, params, name } = parseUrlParams(url);
        const [uuid, serverInfo] = addressPart.split('@');
        const { host, port } = parseServerInfo(serverInfo);

        const tls = createTlsConfig(params);
        if (tls.reality){
            tls.utls = {
                enabled: true,
                fingerprint: "chrome",
            }
        }
        const transport = params.type !== 'tcp' ? createTransportConfig(params) : undefined;

        return {
            type: "vless",
            tag: name,
            server: host,
            server_port: port,
            uuid: decodeURIComponent(uuid),
            tcp_fast_open: false,
            tls: tls,
            transport: transport,
            network: "tcp",
            flow: params.flow ?? undefined
        };
    }
}

class Hysteria2Parser {
    parse(url) {
        const { addressPart, params, name } = parseUrlParams(url);
        // 处理不包含 @ 的 URL 格式
        let host, port;
        let password = null;

        if (addressPart.includes('@')) {
            const [uuid, serverInfo] = addressPart.split('@');
            const parsed = parseServerInfo(serverInfo);
            host = parsed.host;
            port = parsed.port;
            password = decodeURIComponent(uuid);
        } else {
            // 直接解析服务器地址和端口
            const parsed = parseServerInfo(addressPart);
            host = parsed.host;
            port = parsed.port;
            // 如果 URL 中没有 @，则尝试从 params.auth 获取密码
            password = params.auth;
        }

        const tls = createTlsConfig(params);

        const obfs = {};
        if (params['obfs-password']) {
            obfs.type = params.obfs;
            obfs.password = params['obfs-password'];
        };

        return {
            tag: name,
            type: "hysteria2",
            server: host,
            server_port: port,
            password: password,
            tls: tls,
            obfs: obfs,
            auth: params.auth,
            recv_window_conn: params.recv_window_conn,
            up_mbps: params?.upmbps ? parseInt(params.upmbps) : undefined,
            down_mbps: params?.downmbps ? parseInt(params.downmbps) : undefined
        };
    }
}

class TrojanParser {
    parse(url) {
        const { addressPart, params, name } = parseUrlParams(url);
        const [password, serverInfo] = addressPart.split('@');
        const { host, port } = parseServerInfo(serverInfo);

        const parsedURL = parseServerInfo(addressPart);
        const tls = createTlsConfig(params);
        const transport = params.type !== 'tcp' ? createTransportConfig(params) : undefined;
        return {
            type: 'trojan',
            tag: name,
            server: host,
            server_port: port,
            password: decodeURIComponent(password) || parsedURL.username,
            network: "tcp",
            tcp_fast_open: false,
            tls: tls,
            transport: transport,
            flow: params.flow ?? undefined
        };
    }
}

class TuicParser {
    parse(url) {
        const { addressPart, params, name } = parseUrlParams(url);
        const [userinfo, serverInfo] = addressPart.split('@');
        const { host, port } = parseServerInfo(serverInfo);
        const tls = {
            enabled: true,
            server_name: params.sni,
            alpn: [params.alpn],
            insecure: true,
        };

        return {
            tag: name,
            type: "tuic",
            server: host,
            server_port: port,
            uuid: decodeURIComponent(userinfo).split(':')[0],
            password: decodeURIComponent(userinfo).split(':')[1],
            congestion_control: params.congestion_control,
            tls: tls,
            flow: params.flow ?? undefined
        };
    }
}


class HttpParser {
    static async parse(url, userAgent) {
        try {
            let headers = new Headers({
                "User-Agent"   : userAgent
            });
            const response = await fetch(url, {
                method : 'GET',
                headers : headers
            });
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const text = await response.text();
            let decodedText;
            try {
                decodedText = decodeBase64(text.trim());
                // Check if the decoded text needs URL decoding
                if (decodedText.includes('%')) {
                    decodedText = decodeURIComponent(decodedText);
                }
            } catch (e) {
                decodedText = text;
                // Check if the original text needs URL decoding
                if (decodedText.includes('%')) {
                    try {
                        decodedText = decodeURIComponent(decodedText);
                    } catch (urlError) {
                        console.warn('Failed to URL decode the text:', urlError);
                    }
                }
            }
            return decodedText.split('\n').filter(line => line.trim() !== '');
        } catch (error) {
            console.error('Error fetching or parsing HTTP(S) content:', error);
            return null;
        }
    }
}
