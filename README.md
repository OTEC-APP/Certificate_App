# CertTrack Dashboard

A certificate-management dashboard built with React, Bootstrap, FastAPI, and Firebase Firestore.

## Project structure

- `frontend/` — React (Create React App) + Bootstrap administrative dashboard
- `backend/` — Python FastAPI REST API with Firebase Admin / Firestore

## Run locally

### 1. Backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
copy .env.example .env
python main.py
```

If the repository was copied from another computer or directory, recreate
`backend/.venv`; Python virtual environments contain absolute paths and are not
portable. For auto-reload during development, run the package from the project
root after activating the environment:

```powershell
python -m uvicorn backend.main:app --host 0.0.0.0 --port 5000 --reload
```

For Firebase, create a Firebase project, enable **Firestore Database**, download a service-account JSON key, and set `FIREBASE_SERVICE_ACCOUNT_PATH` in `backend/.env` to its absolute path. Without these settings, the API starts in demo mode so the UI remains usable.

### 2. Frontend

```powershell
cd frontend
npm install
npm start
```

Open `http://localhost:3000`. The frontend calls `/api` by default and the development proxy forwards it to the port configured in `frontend/package.json` (currently `5003`).

## Cloud Run production deployment

Deploy the API and frontend as separate Cloud Run services. Keep the separate `.env.production` files out of Git. In Cloud Run, set real values through service environment variables and Secret Manager.

1. Enable Cloud Run, Cloud Build, Artifact Registry, Secret Manager, and Firestore in your GCP project. Create an Artifact Registry Docker repository.
2. Create a dedicated Cloud Run service account and grant it only the Firebase / Firestore / Cloud Storage permissions this app needs. Cloud Run uses this identity through Application Default Credentials; never deploy `certtract.json` or any Firebase JSON key.
3. Build and deploy the API from `backend/`:

```bash
gcloud builds submit --tag REGION-docker.pkg.dev/PROJECT_ID/REPOSITORY/otec-api
gcloud run deploy otec-api \
  --image REGION-docker.pkg.dev/PROJECT_ID/REPOSITORY/otec-api \
  --region REGION \
  --service-account otec-runtime@PROJECT_ID.iam.gserviceaccount.com \
  --set-env-vars FIREBASE_STORAGE_BUCKET=PROJECT_ID.appspot.com \
  --set-secrets AZURE_CLIENT_SECRET=AZURE_CLIENT_SECRET:latest,AZURE_SSO_CLIENT_SECRET=AZURE_SSO_CLIENT_SECRET:latest
```

4. After Cloud Run returns the API URL, build and deploy the frontend from the repository root. The API URL is compiled into the React bundle:

```bash
gcloud builds submit --config=deploy/cloudbuild.frontend.yaml \
  --substitutions=_IMAGE=REGION-docker.pkg.dev/PROJECT_ID/REPOSITORY/otec-web,_API_URL=https://API_URL/api,_REGION=REGION,_SERVICE=otec-web
```

5. Set `CERTTRACK_APP_URL`, `FRONTEND_URL`, and `ALLOWED_ORIGINS` on `otec-api` to the final frontend URL. Set `AZURE_SSO_REDIRECT_URI` to `https://YOUR_CLOUD_RUN_API_URL/auth/callback`, register that exact URI in the Microsoft Entra app registration, then add the remaining Azure values (with secrets sourced from Secret Manager) and redeploy the API.

## Firebase Hosting frontend deployment

Firebase Hosting deploys the React frontend only; keep the FastAPI API on Cloud Run. Before deploying, set `REACT_APP_API_URL=https://YOUR_CLOUD_RUN_API_URL/api` in `frontend/.env.production` and replace `YOUR_FIREBASE_PROJECT_ID` in `.firebaserc`. Then run from the repository root:

```bash
npx firebase-tools login
npx firebase-tools deploy --only hosting
```

The Hosting predeploy step builds `frontend/` automatically. After deployment, update the Cloud Run API's `CERTTRACK_APP_URL`, `FRONTEND_URL`, and `ALLOWED_ORIGINS` values to the Firebase Hosting URL, then redeploy the API.

## API

- `GET /api/dashboard`
- `GET /api/certificates?search=&status=`
- `POST /api/certificates`
- `PATCH /api/certificates/{id}/status`
- `GET /api/verify/{certificate_number}`
