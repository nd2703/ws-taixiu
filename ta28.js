const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');

class GameWebSocketClient {
    constructor(url) {
        this.url = url;
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 5000;
        this.isAuthenticated = false;
        this.sessionId = null;
        this.latestTxData = null;
        this.latestMd5Data = null;
        this.lastUpdateTime = {
            tx: null,
            md5: null
        };
    }

    connect() {
        console.log('🔗 Connecting to WebSocket server...');
        console.log(`📡 URL: ${this.url}`);
        
        this.ws = new WebSocket(this.url, {
            headers: {
                'Host': 'api.api-sao789.space',
                'Origin': 'https://play.sao789a.me/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Pragma': 'no-cache',
                'Cache-Control': 'no-cache',
                'Accept-Encoding': 'gzip, deflate, br',
                'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7'
            },
            rejectUnauthorized: false,  // Bỏ qua lỗi SSL nếu có
            perMessageDeflate: false     // Tắt nén để tránh lỗi
        });

        this.setupEventHandlers();
    }

    setupEventHandlers() {
        this.ws.on('open', () => {
            console.log('✅ Connected to WebSocket server');
            this.reconnectAttempts = 0;
            this.sendAuthentication();
        });

        this.ws.on('message', (data) => {
            this.handleMessage(data);
        });

        this.ws.on('error', (error) => {
            console.error('❌ WebSocket error:', error.message);
        });

        this.ws.on('close', (code, reason) => {
            console.log(`🔌 Connection closed. Code: ${code}, Reason: ${String(reason)}`);
            this.isAuthenticated = false;
            this.sessionId = null;
            this.handleReconnect();
        });

        this.ws.on('pong', () => {
            console.log('❤️ Heartbeat received from server');
        });
    }

    sendAuthentication() {
        console.log('🔐 Sending authentication...');
        
        // Sử dụng thông tin xác thực mới nhất
        const authMessage = [1,"MiniGame","Harry2703","Admin12345",{"signature":"3C5F4E3CD1176A26EE3D9A7BE3E09D6D40EA6261DDAB60BC0A706B72DD608FCA44C16F5A1D5FE19A02291A036201F5C6576C92728BA40D0AFCFF3E6E7236247357F0C573DD0279C64095C4016B6D886AAE2DEB1CF5107A8C49327C103068A3EBDCA8B0BD01210F287FE50E3945068896950E278475214B1D7A2032D0E2E620B7","info":{"cs":"4fe0cdd28a9c6665fb3b42e1909db4bc","phone":"84896879272","ipAddress":"2001:ee0:f1ba:330:a43c:8bfe:87dc:98e7","isMerchant":false,"userId":"261106ab-d733-4f32-b76a-298ea51e5b65","deviceId":"250100646453736148000537365720128032","isMktAccount":false,"username":"harry2703","timestamp":1780057902070},"pid":4}];

        this.sendRaw(authMessage);
    }

    sendPluginMessages() {
        console.log('🚀 Sending plugin initialization messages...');
        
        const pluginMessages = [
            [6,"MiniGame","taixiuPlugin",{"cmd":1005}],
            [6,"MiniGame","taixiuMd5Plugin",{"cmd":1105}],
            [6,"MiniGame","lobbyPlugin",{"cmd":10001}],
            [6,"MiniGame","channelPlugin",{"cmd":310}]
        ];

        pluginMessages.forEach((message, index) => {
            setTimeout(() => {
                console.log(`📤 Sending plugin ${index + 1}/${pluginMessages.length}: ${message[2]}`);
                this.sendRaw(message);
            }, index * 1000);
        });

        setInterval(() => {
            this.refreshGameData();
        }, 30000);
    }

    refreshGameData() {
        if (this.isAuthenticated && this.ws && this.ws.readyState === WebSocket.OPEN) {
            console.log('🔄 Refreshing game data...');
            const refreshTx = [6, "MiniGame", "taixiuPlugin", { "cmd": 1005 }];
            const refreshMd5 = [6, "MiniGame", "taixiuMd5Plugin", { "cmd": 1105 }];
            this.sendRaw(refreshTx);
            setTimeout(() => {
                this.sendRaw(refreshMd5);
            }, 1000);
        }
    }

    sendRaw(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            const jsonString = JSON.stringify(data);
            this.ws.send(jsonString);
            console.log('📤 Sent:', JSON.stringify(data).substring(0, 200) + '...');
            return true;
        } else {
            console.log('⚠️ Cannot send, WebSocket not open');
            return false;
        }
    }

    handleMessage(data) {
        try {
            const parsed = JSON.parse(data);
            
            if (parsed[0] === 5 && parsed[1] && parsed[1].cmd === 1005) {
                console.log('🎯 Received cmd 1005 (TX Table)');
                const gameData = parsed[1];
                if (gameData.htr && gameData.htr.length > 0) {
                    const latestSession = gameData.htr.reduce((prev, current) => (current.sid > prev.sid) ? current : prev);
                    console.log(`🎲 TX - Session: ${latestSession.sid} (${latestSession.d1},${latestSession.d2},${latestSession.d3})`);
                    this.latestTxData = gameData;
                    this.lastUpdateTime.tx = new Date();
                }
            }
            else if (parsed[0] === 5 && parsed[1] && parsed[1].cmd === 1105) {
                console.log('🎯 Received cmd 1105 (MD5 Table)');
                const gameData = parsed[1];
                if (gameData.htr && gameData.htr.length > 0) {
                    const latestSession = gameData.htr.reduce((prev, current) => (current.sid > prev.sid) ? current : prev);
                    console.log(`🎲 MD5 - Session: ${latestSession.sid} (${latestSession.d1},${latestSession.d2},${latestSession.d3})`);
                    this.latestMd5Data = gameData;
                    this.lastUpdateTime.md5 = new Date();
                }
            }
            else if (parsed[0] === 5 && parsed[1] && parsed[1].cmd === 100) {
                console.log('🔑 Authentication successful!');
                this.isAuthenticated = true;
                setTimeout(() => {
                    this.sendPluginMessages();
                }, 2000);
            }
            else if (parsed[0] === 1 && parsed.length >= 5 && parsed[4] === "MiniGame") {
                console.log('✅ Session initialized');
                this.sessionId = parsed[3];
                console.log(`📋 Session ID: ${this.sessionId}`);
            }
            
        } catch (e) {
            console.log('📥 Raw message:', data.toString());
            console.error('❌ Parse error:', e.message);
        }
    }

    getLatestTxSession() {
        if (!this.latestTxData || !this.latestTxData.htr || this.latestTxData.htr.length === 0) {
            return { error: "Không có dữ liệu bàn TX" };
        }
        const latestSession = this.latestTxData.htr.reduce((prev, current) => (current.sid > prev.sid) ? current : prev);
        const tong = latestSession.d1 + latestSession.d2 + latestSession.d3;
        return {
            phien: latestSession.sid,
            xuc_xac_1: latestSession.d1,
            xuc_xac_2: latestSession.d2,
            xuc_xac_3: latestSession.d3,
            tong: tong,
            ket_qua: tong >= 11 ? "tài" : "xỉu",
            timestamp: new Date().toISOString(),
            ban: "tai_xiu"
        };
    }

    getLatestMd5Session() {
        if (!this.latestMd5Data || !this.latestMd5Data.htr || this.latestMd5Data.htr.length === 0) {
            return { error: "Không có dữ liệu bàn MD5" };
        }
        const latestSession = this.latestMd5Data.htr.reduce((prev, current) => (current.sid > prev.sid) ? current : prev);
        const tong = latestSession.d1 + latestSession.d2 + latestSession.d3;
        return {
            phien: latestSession.sid,
            xuc_xac_1: latestSession.d1,
            xuc_xac_2: latestSession.d2,
            xuc_xac_3: latestSession.d3,
            tong: tong,
            ket_qua: tong >= 11 ? "tài" : "xỉu",
            timestamp: new Date().toISOString(),
            ban: "md5"
        };
    }

    handleReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = this.reconnectDelay * this.reconnectAttempts;
            console.log(`🔄 Reconnecting in ${delay}ms (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
            setTimeout(() => {
                this.connect();
            }, delay);
        }
    }

    startHeartbeat() {
        setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.sendRaw([0, this.sessionId || ""]);
            }
        }, 25000);
    }

    close() {
        if (this.ws) {
            this.ws.close();
        }
    }
}

const app = express();
const PORT = 3072;
app.use(cors());
app.use(express.json());

// SỬ DỤNG URL MỚI NHẤT
const client = new GameWebSocketClient('wss://api.api-sao789.space/websocket?d=YTIxaGJtaGtiV2s9fDMyMDR8MTc4MDA1ODE4NDk2NHxiNWQxMjNmMzljMjhhZWY3ZDk4NGE3YWY1NzM3Mzk3N18xMTc1MWE4YWVkODhhMTBiMzhmODBjODk1NzQwZGI1ZXw5N2Y5ZDVjNjk1MDFmMDQ3OTY3MmExY2VlNjc2YjdhZXwyQ0IwOUFERg==');
client.connect();

app.get('/api/tx', (req, res) => {
    res.json(client.getLatestTxSession());
});

app.get('/api/md5', (req, res) => {
    res.json(client.getLatestMd5Session());
});

app.get('/api/all', (req, res) => {
    res.json({
        tai_xiu: client.getLatestTxSession(),
        md5: client.getLatestMd5Session(),
        timestamp: new Date().toISOString()
    });
});

app.get('/api/status', (req, res) => {
    res.json({
        status: "running",
        websocket_connected: client.ws ? client.ws.readyState === WebSocket.OPEN : false,
        authenticated: client.isAuthenticated,
        timestamp: new Date().toISOString()
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
});

setTimeout(() => {
    client.startHeartbeat();
}, 10000);

module.exports = { GameWebSocketClient, app };
