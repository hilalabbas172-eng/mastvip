// models/User.js

const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, trim: true, minlength: 3 },
    password: { type: String, required: true },
    balance: { type: Number, default: 0.00 },
    vipLevel: { type: Number, default: 0 },
    referralCode: { type: String, unique: true, required: true, uppercase: true },
    referrer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    
    // حقول الوكلاء
    isAgent: { type: Boolean, default: false }, // لتحديد إذا كان المستخدم وكيل أم لا
    monthlySalary: { type: Number, default: 0 }, // راتب الوكيل الشهري (إذا كان موجوداً)
    clientsCount: { type: Number, default: 0 }, // عدد العملاء الذين جذبهم الوكيل
    lastSalaryDate: { type: Date, default: null }, // آخر تاريخ استلم فيه راتبه
    
    // الصلاحيات المالية للوكيل (مهم جداً)
    canManageClientFunds: { type: Boolean, default: false }, // صلاحية الوصول لأدوات الإيداع/السحب
    commissionBalance: { type: Number, default: 0.00 }, // العمولة المستحقة للوكيل

    isAdmin: { type: Boolean, default: false }
}, {
    timestamps: true
});

const User = mongoose.model('User', UserSchema);
module.exports = User;