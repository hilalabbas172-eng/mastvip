// models/Settings.js

const mongoose = require('mongoose');

const SettingsSchema = new mongoose.Schema({
    uniqueId: { type: Number, default: 1, unique: true },
    depositWallet: { type: String, default: 'TDBLankWalletAddressForMasterVIP', trim: true },
    minDeposit: { type: Number, default: 12 },
    withdrawalFee: { type: Number, default: 5 }
}, {
    timestamps: true
});

const Settings = mongoose.model('Settings', SettingsSchema);
module.exports = Settings;