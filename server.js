// server.js

const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
// const dotenv = require('dotenv'); // 👈 تم حذف/تعطيل هذا السطر
const bcrypt = require('bcrypt');
const session = require('express-session');
const MongoStore = require('connect-mongo');

// dotenv.config(); // 👈 تم حذف/تعطيل هذا السطر

const app = express();
const PORT = process.env.PORT || 5000;
// قراءة المتغيرات مباشرة من بيئة Render
const MONGO_URI = process.env.MONGO_URI; 
const SESSION_SECRET = process.env.MASTER_VIP_SECRET_KEY || 'default_secret_key_fallback'; 
// 🚨 يجب أن يكون MASTER_VIP_SECRET_KEY هو اسم المتغير في Render 🚨


// 1. إعداد الـ Proxy (لتوافق Render) 
app.set('trust proxy', 1); 

// 2. الاتصال بقاعدة البيانات
mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Successfully connected to MongoDB Atlas!'))
    .catch(err => console.error('❌ MongoDB connection error:', err));

// 3. إعداد الجلسات (Sessions)
const sessionConfig = {
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: MONGO_URI,
        collectionName: 'sessions',
        ttl: 14 * 24 * 60 * 60 
    }),
    cookie: {
        httpOnly: true,
        secure: true, // تفعيل Secure للعمل مع HTTPS على Render 
        maxAge: 1000 * 60 * 60 * 24 * 7 
    }
};
app.use(session(sessionConfig));


// 4. الإعدادات العامة (Middleware)
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'assets'))); 
app.use(express.static(path.join(__dirname, 'images'))); 


// 5. متطلبات الموديل (User Model)
const User = require('./models/User'); 


// 6. دوال الحماية (Middleware)
const isAuthenticated = (req, res, next) => {
    if (req.session.userId) {
        return next();
    }
    res.redirect('/auth');
};

const isAdmin = async (req, res, next) => {
    try {
        const user = await User.findById(req.session.userId);
        if (user && user.isAdmin) {
            next();
        } else {
            res.status(403).send('Access Denied. You are not an Admin.');
        }
    } catch (err) {
        res.status(500).send('Authentication Error.');
    }
};

const isAgentWithFundsAccess = async (req, res, next) => {
    try {
        const user = await User.findById(req.session.userId);
        if (user && user.isAgent && user.canManageClientFunds) {
            next();
        } else {
            res.status(403).send('Access Denied. You are not an authorized financial agent.');
        }
    } catch (err) {
        res.status(500).send('Authentication Error.');
    }
};


// 7. مسارات العرض (GET Routes)

app.get('/', (req, res) => {
    res.render('index');
});

app.get('/auth', (req, res) => {
    res.render('auth', { registered: req.query.registered, error: req.query.error }); 
});

app.get('/profile', isAuthenticated, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        if (!user) {
            req.session.destroy();
            return res.redirect('/auth');
        }
        
        if (user.isAgent && user.canManageClientFunds) {
            return res.redirect('/agent-dashboard'); 
        }

        res.render('profile', { user });

    } catch (err) {
        res.status(500).send('Error loading profile.');
    }
});

app.get('/agent-dashboard', isAuthenticated, isAgentWithFundsAccess, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);

        if (!user) {
            req.session.destroy();
            return res.redirect('/auth');
        }
        
        res.render('agent_dashboard', { 
            agentUsername: user.username,
            agentBalance: user.balance ? user.balance.toFixed(2) : '0.00',
            agentCommission: user.commissionBalance ? user.commissionBalance.toFixed(2) : '0.00',
            msg: req.query.msg
        });

    } catch (err) {
        console.error('Error loading agent dashboard:', err);
        res.status(500).send('حدث خطأ أثناء تحميل لوحة الوكيل.');
    }
});


app.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) return res.redirect('/profile');
        res.redirect('/auth');
    });
});


// 8. مسارات معالجة النماذج (POST Routes)

// مسار الدخول (LOGIN)
app.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username });

        if (!user) {
            return res.redirect('/auth?error=' + encodeURIComponent('❌ اسم المستخدم غير موجود.'));
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.redirect('/auth?error=' + encodeURIComponent('❌ كلمة المرور غير صحيحة.'));
        }

        req.session.userId = user._id;

        if (user.isAdmin) {
            res.redirect('/admin');
        } else if (user.isAgent && user.canManageClientFunds) {
            res.redirect('/agent-dashboard');
        } else {
            res.redirect('/profile');
        }
        
    } catch (error) {
        res.status(500).send('Error during login.');
    }
});


// مسار التسجيل العادي (للعملاء غير المسجلين عبر وكيل)
app.post('/register', async (req, res) => {
    try {
        const { username, password, referrerCode } = req.body;
        
        const hashedPassword = await bcrypt.hash(password, 10);
        
        let referrerId = null;
        let referrerUser = null; 

        if (referrerCode) {
            referrerUser = await User.findOne({ referralCode: referrerCode.toUpperCase() });
            if (referrerUser) {
                referrerId = referrerUser._id;
            }
        }

        // منطق توليد كود إحالة فريد
        let referralCodeUnique;
        let codeExists = true;
        while (codeExists) {
            referralCodeUnique = Math.random().toString(36).substring(2, 8).toUpperCase();
            const check = await User.findOne({ referralCode: referralCodeUnique });
            if (!check) {
                codeExists = false;
            }
        }

        const newUser = new User({
            username,
            password: hashedPassword,
            referralCode: referralCodeUnique,
            referrer: referrerId
            // ... (بقية الحقول)
        });
        await newUser.save();

        if (referrerUser && referrerUser.isAgent) {
            referrerUser.clientsCount += 1;
            await referrerUser.save();
        }

        res.redirect('/auth?registered=true');
    } catch (error) {
        res.status(500).send('Error registering user.');
    }
});

// مسار تسجيل عميل بواسطة الوكيل المالي 
app.post('/agent/register-client', isAuthenticated, isAgentWithFundsAccess, async (req, res) => {
    try {
        const { clientUsername, clientPassword } = req.body;
        
        const existingUser = await User.findOne({ username: clientUsername });
        if (existingUser) {
            return res.redirect('/agent-dashboard?msg=' + encodeURIComponent('❌ اسم المستخدم هذا موجود بالفعل.'));
        }

        const agentUser = await User.findById(req.session.userId);
        if (!agentUser) {
             return res.redirect('/agent-dashboard?msg=' + encodeURIComponent('❌ خطأ: لم يتم العثور على حساب الوكيل.'));
        }

        let referralCode;
        let codeExists = true;
        while (codeExists) {
            referralCode = Math.random().toString(36).substring(2, 8).toUpperCase();
            const check = await User.findOne({ referralCode });
            if (!check) {
                codeExists = false;
            }
        }
        
        const hashedPassword = await bcrypt.hash(clientPassword, 10); 

        const newClient = new User({
            username: clientUsername,
            password: hashedPassword,
            referralCode: referralCode,
            referrer: agentUser._id, 
            clientsCount: 0,
            balance: 0.00 
        });

        await newClient.save();
        agentUser.clientsCount += 1;
        await agentUser.save();

        res.redirect('/agent-dashboard?msg=' + encodeURIComponent(`✅ تم تسجيل العميل ${clientUsername} بنجاح! يمكنك الآن شحن رصيده في القسم التالي.`));

    } catch (error) {
        console.error('Error in agent registering client:', error);
        res.status(500).send('حدث خطأ أثناء تسجيل العميل.');
    }
});


// مسار إيداع العملاء بواسطة الوكيل المالي (20% عمولة) 
app.post('/agent/deposit', isAuthenticated, isAgentWithFundsAccess, async (req, res) => {
    try {
        const { clientUsername, amount } = req.body;
        const depositAmount = parseFloat(amount);

        if (depositAmount <= 0 || isNaN(depositAmount)) {
            return res.redirect('/agent-dashboard?msg=' + encodeURIComponent('❌ مبلغ الإيداع غير صالح.'));
        }

        const client = await User.findOne({ username: clientUsername });
        const agent = await User.findById(req.session.userId); 

        if (!client || !agent) {
            return res.redirect('/agent-dashboard?msg=' + encodeURIComponent('❌ لم يتم العثور على المستخدم/الوكيل.'));
        }

        // 1. تحديث رصيد العميل
        client.balance += depositAmount;
        await client.save();
        
        // 2. حساب عمولة الإيداع (20%)
        const depositCommission = depositAmount * 0.20; 
        
        // 3. إضافة العمولة إلى رصيد العمولة الخاص بالوكيل
        agent.commissionBalance += depositCommission;
        await agent.save();

        res.redirect('/agent-dashboard?msg=' + encodeURIComponent(`✅ تم إيداع ${depositAmount.toFixed(2)} USDT في حساب ${clientUsername}. تم إضافة عمولة ${depositCommission.toFixed(2)} إلى حسابك.`));

    } catch (error) {
        console.error('Error in agent deposit:', error);
        res.status(500).send('حدث خطأ أثناء عملية الإيداع.');
    }
});


// مسار سحب العملاء بواسطة الوكيل المالي (10% عمولة) 
app.post('/agent/withdraw', isAuthenticated, isAgentWithFundsAccess, async (req, res) => {
    try {
        const { clientUsername, amount } = req.body;
        const withdrawalAmount = parseFloat(amount);

        if (withdrawalAmount <= 0 || isNaN(withdrawalAmount)) {
            return res.redirect('/agent-dashboard?msg=' + encodeURIComponent('❌ مبلغ السحب غير صالح.'));
        }

        const client = await User.findOne({ username: clientUsername });
        const agent = await User.findById(req.session.userId); 

        if (!client || !agent) {
            return res.redirect('/agent-dashboard?msg=' + encodeURIComponent('❌ لم يتم العثور على المستخدم/الوكيل.'));
        }
        
        if (client.balance < withdrawalAmount) {
             return res.redirect('/agent-dashboard?msg=' + encodeURIComponent(`❌ رصيد ${clientUsername} غير كافٍ للسحب.`));
        }

        // 1. تحديث رصيد العميل
        client.balance -= withdrawalAmount;
        await client.save();

        // 2. حساب عمولة السحب (10%)
        const withdrawalCommission = withdrawalAmount * 0.10; 
        
        // 3. إضافة العمولة إلى رصيد العمولة الخاص بالوكيل
        agent.commissionBalance += withdrawalCommission;
        await agent.save();
        
        res.redirect('/agent-dashboard?msg=' + encodeURIComponent(`✅ تم سحب ${withdrawalAmount.toFixed(2)} USDT من حساب ${clientUsername}. تم إضافة عمولة ${withdrawalCommission.toFixed(2)} إلى حسابك.`));

    } catch (error) {
        console.error('Error in agent withdrawal:', error);
        res.status(500).send('حدث خطأ أثناء عملية السحب.');
    }
});

// 9. تشغيل السيرفر
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});