const express = require('express');
const cors = require('cors');
const multer = require('multer');
const jwt = require('jsonwebtoken');
var AWS = require('aws-sdk');
const fs = require('fs');
const bodyParser = require('body-parser');
const { Imagebuilder } = require('aws-sdk');
require('dotenv').config()

const app = express();

// To upload image files at specific location
const upload = multer({ dest: process.env.FILE_UPLOAD_PATH });

app.use(cors());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Below AWS details are configured in AWS CLI configuration
var credentials = new AWS.SharedIniFileCredentials({profile: process.env.AWS_PROFILE});
AWS.config.credentials = credentials;
AWS.config.update({region: process.env.AWS_REGION});
const client = new AWS.Rekognition();

const users = new Set();
const userRequests = [];

// Middleware to check if the user is authenticated or not
const verifyToken = (req, res, next) => {
    const token = req.headers.authorization;

    if (!token) return res.status(401).json({ message: 'Unauthorized' });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
        req.user = decoded.username;
        next();
    } catch (err) {
        return res.status(401).json({ message: 'Invalid token' });
    }
}

app.post('/login', (req, res) => {
    const { username } = req.body;

    if (users.has(username)) return res.status(409).json({ message: 'Username already taken' });

    users.add(username);

    const token = jwt.sign({ username }, process.env.JWT_SECRET_KEY, { expiresIn: process.env.JWT_EXPIRATION_TIME });

    res.json({ token });
});

// To send all the requests made by particular user
app.get('/requests', verifyToken, async(req, res) => {
    res.json({ userRequests: userRequests.filter(ele => ele.userId === req.user) });
});

// To detect number of faces, age range and other details based on uploaded image
// First verifying the authenticated user and then to upload an image file
app.post('/detect', verifyToken, upload.single('image'), async(req, res) => {
    try {
        // Sending image buffer to AWS rekognition API
        const imageBuffer = fs.readFileSync(req.file.path);
        const params = {
            Image: {
                Bytes: imageBuffer
            //   S3Object: {
            //     Bucket: bucket,
            //     Name: photo
            //   },
            },
            Attributes: ["ALL", "DEFAULT"]
        }

        // Calling AWS API to get face recongintion details
        client.detectFaces(params, function(err, response) {
            if (err) {
              console.log(err, err.stack);
            } else {
                // Storing necessary details in an object and sending it to user
                let mCount = 0, fCount = 0, ageLow = 0, ageHigh = 0, eyeGlassesCount = 0;
                response.FaceDetails.forEach(ele => {
                    if (ele.Gender.Value === 'Male') mCount++;
                    else if (ele.Gender.Value === 'Female') fCount++;

                    if (ele.AgeRange.Low < ageLow || ageLow == 0) ageLow = ele.AgeRange.Low;
                    if (ele.AgeRange.High > ageHigh || ageHigh == 0) ageHigh = ele.AgeRange.High;

                    if (ele.Eyeglasses.Value == true) eyeGlassesCount++;
                });
                let obj = {
                    id: userRequests.length + 1,
                    userId: req.user,
                    name: req.body.name,
                    image: 'data:image/jpeg;base64,'+imageBuffer.toString('base64'),
                    personCount: response.FaceDetails.length,
                    mCount: mCount,
                    fCount: fCount,
                    ageHigh: ageHigh,
                    ageLow: ageLow,
                    eyeGlassesCount: eyeGlassesCount
                }
                userRequests.push(obj);
                res.json({ data: obj });
            } 
          });
    } catch (err) {
        console.log('Something went wrong', err);
    }
});

app.listen(8000, () => {
    console.log('Server started on port 8000');
});