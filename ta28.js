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
        this.latestTxData = null;   // Bàn Tài Xỉu thường (cmd 1005)
        this.latestMd5Data = null;  // Bàn MD5 (cmd 1105)
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
                'Host': 'api.api-ta28.space',
                'Origin': 'https://play.ta28.chat/',
                'Referer': 'https://play.ta28.chat/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
                'Pragma': 'no-cache',
                'Cache-Control': 'no-cache',
                'Accept-Encoding': 'gzip, deflate, br, zstd',
                'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8',
                'Connection': 'Upgrade',
                'Upgrade': 'websocket',
                'Sec-WebSocket-Version': '13',
                'Sec-WebSocket-Extensions': 'permessage-deflate; client_max_window_bits'
            }
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
        console.log('🔐 Sending authentication for Harry2703...');
       
        const authMessage = [
            1,
            "MiniGame",
            "Harry2703",
            "Admin12345@",
            {
                "signature": "53F0F5712D1CA7F1D804096FA556C763C9A12785BA4B3F6C5B5C78E49F3B358C242158B1D6CEA64B6CEA896D45050976001EC29805B1DA0A866A7AB8462207990F4C066105F350C6A76FA6FF164707883D56165AFA412052D205A50283C5D77E971C2C705B5F7BD8613E266E9A221D7F10E6BA0ED471FB219D05EB4FAC65E9DF",
                "info": {
                    "cs": "0bf70b4ac93c9cfa8dba93c9bb956401",
                    "phone": "84896879272",
                    "ipAddress": "2001:ee0:f1ba:330:6857:177b:85a4:3a2b",
                    "isMerchant": false,
                    "userId": "353e702c-b450-424f-965c-628fb2cdbe5b",
                    "deviceId": "250100646453736148000537365720128032",
                    "isMktAccount": false,
                    "username": "harry2703",
                    "timestamp": 1779253290062
                },
                "pid": 4
            }
        ];
        this.sendRaw(authMessage);
    }

    sendPluginMessages() {
        console.log('🚀 Sending plugin initialization messages...');
       
        const pluginMessages = [
            [6, "MiniGame", "taixiuMd5Plugin", { "cmd": 1105 }],
            [6, "MiniGame", "taixiuPlugin", { "cmd": 1005 }],
            [6, "MiniGame", "taixiuLiveRoomPlugin", { "cmd": 1305, "rid": 0 }],
            [6, "MiniGame", "taixiuLiveRoomPlugin", { "cmd": 1305, "rid": 5 }],
            [6, "MiniGame", "lobbyPlugin", { "cmd": 10001 }],
            [6, "MiniGame", "channelPlugin", { "cmd": 310 }]
        ];

        pluginMessages.forEach((message, index) => {
            setTimeout(() => {
                console.log(`📤 Sending plugin ${index + 1}/${pluginMessages.length}`);
                this.sendRaw(message);
            }, index * 1000);
        });

        // Auto refresh every 30 seconds
        setInterval(() => {
            this.refreshGameData();
        }, 30000);
    }

    refreshGameData() {
        if (this.isAuthenticated && this.ws && this.ws.readyState === WebSocket.OPEN) {
            console.log('🔄 Refreshing game data...');
            this.sendRaw([6, "MiniGame", "taixiuPlugin", { "cmd": 1005 }]);
            setTimeout(() => {
                this.sendRaw([6, "MiniGame", "taixiuMd5Plugin", { "cmd": 1105 }]);
            }, 1000);
        }
    }

    sendRaw(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            const jsonString = JSON.stringify(data);
            this.ws.send(jsonString);
            // console.log('📤 Sent:', jsonString); // Uncomment nếu muốn xem chi tiết
            return true;
        } else {
            console.log('⚠️ Cannot send, WebSocket not open');
            return false;
        }
    }

    handleMessage(data) {
        try {
            const parsed = JSON.parse(data);

            // CMD 1005 - Tài Xỉu thường
            if (parsed[0] === 5 && parsed[1] && parsed[1].cmd === 1005) {
                const gameData = parsed[1];
                if (gameData.htr && gameData.htr.length > 0) {
                    const latest = gameData.htr.reduce((prev, curr) => (curr.sid > prev.sid) ? curr : prev);
                    console.log(`🎲 TX - Phiên ${latest.sid} | ${latest.d1},${latest.d2},${latest.d3} | ${latest.d1 + latest.d2 + latest.d3}`);
                    this.latestTxData = gameData;
                    this.lastUpdateTime.tx = new Date();
                }
            }

            // CMD 1105 - MD5
            else if (parsed[0] === 5 && parsed[1] && parsed[1].cmd === 1105) {
                const gameData = parsed[1];
                if (gameData.htr && gameData.htr.length > 0) {
                    const latest = gameData.htr.reduce((prev, curr) => (curr.sid > prev.sid) ? curr : prev);
                    console.log(`🎲 MD5 - Phiên ${latest.sid} | ${latest.d1},${latest.d2},${latest.d3} | ${latest.d1 + latest.d2 + latest.d3}`);
                    this.latestMd5Data = gameData;
                    this.lastUpdateTime.md5 = new Date();
                }
            }

            // Authentication success
            else if (parsed[0] === 5 && parsed[1] && parsed[1].cmd === 100) {
                console.log('🔑 Authentication successful!');
                this.isAuthenticated = true;
                setTimeout(() => this.sendPluginMessages(), 1500);
            }

            else if (parsed[0] === 1 && parsed.length >= 5) {
                this.sessionId = parsed[3];
                console.log(`📋 Session ID: ${this.sessionId}`);
            }

        } catch (e) {
            console.error('❌ Parse error:', e.message);
        }
    }

    getLatestTxSession() {
        if (!this.latestTxData?.htr?.length) {
            return { error: "Chưa có dữ liệu bàn Tài Xỉu" };
        }
        const latest = this.latestTxData.htr.reduce((p, c) => (c.sid > p.sid ? c : p));
        const tong = latest.d1 + latest.d2 + latest.d3;
        return {
            phien: latest.sid,
            xuc_xac_1: latest.d1,
            xuc_xac_2: latest.d2,
            xuc_xac_3: latest.d3,
            tong: tong,
            ket_qua: tong >= 11 ? "tài" : "xỉu",
            ban: "tai_xiu",
            timestamp: new Date().toISOString(),
            last_updated: this.lastUpdateTime.tx?.toISOString()
        };
    }

    getLatestMd5Session() {
        if (!this.latestMd5Data?.htr?.length) {
            return { error: "Chưa có dữ liệu bàn MD5" };
        }
        const latest = this.latestMd5Data.htr.reduce((p, c) => (c.sid > p.sid ? c : p));
        const tong = latest.d1 + latest.d2 + latest.d3;
        return {
            phien: latest.sid,
            xuc_xac_1: latest.d1,
            xuc_xac_2: latest.d2,
            xuc_xac_3: latest.d3,
            tong: tong,
            ket_qua: tong >= 11 ? "tài" : "xỉu",
            ban: "md5",
            timestamp: new Date().toISOString(),
            last_updated: this.lastUpdateTime.md5?.toISOString()
        };
    }

    handleReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = this.reconnectDelay * this.reconnectAttempts;
            console.log(`🔄 Reconnecting in ${delay}ms (Attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
            setTimeout(() => this.connect(), delay);
        } else {
            console.log('❌ Max reconnection attempts reached');
        }
    }

    startHeartbeat() {
        setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
                this.sendRaw([0, this.sessionId || ""]);
            }
        }, 25000);
    }

    close() {
        if (this.ws) this.ws.close();
    }
}

// ====================== EXPRESS SERVER ======================
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ==================== CLIENT INIT =====================
const client = new GameWebSocketClient(
    'wss://api.api-ta28.space/websocket?d=YUcxaGNHaGljRzQ9fDE1NTN8MTc3OTI1MzI4ODY3N3xjYjk3ZWQyYTExZmU5ZThlYzY4MzhiMjE1ZjI1MjJmNXw1NGQ4MTM1MGJkYzgxMGE1Y2RlNzAxYWVjM2YxMTY1ZHwzMTVEMzMwQg=='
);

client.connect();

// ====================== ROUTES ======================
app.get('/api/tx', (req, res) => {
    const data = client.getLatestTxSession();
    res.json(data);
});

app.get('/api/md5', (req, res) => {
    const data = client.getLatestMd5Session();
    res.json(data);
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
        websocket_connected: client.ws?.readyState === WebSocket.OPEN,
        authenticated: client.isAuthenticated,
        has_tx_data: !!client.latestTxData?.htr?.length,
        has_md5_data: !!client.latestMd5Data?.htr?.length,
        tx_last_updated: client.lastUpdateTime.tx?.toISOString() || null,
        md5_last_updated: client.lastUpdateTime.md5?.toISOString() || null,
        timestamp: new Date().toISOString()
    });
});

app.get('/api/refresh', (req, res) => {
    client.refreshGameData();
    res.json({ message: "Refresh request sent", timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
    res.send('<h1>✅ TA28 API Server is Running</h1><p>Endpoints: /api/tx, /api/md5, /api/all, /api/status</p>');
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
});

setTimeout(() => {
    client.startHeartbeat();
}, 10000);

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n👋 Shutting down...');
    client.close();
    process.exit();
});

module.exports = { GameWebSocketClient, app };
