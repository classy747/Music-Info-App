# HideYourKeys

## NASA Revisited
NodeJS can help us to secure our API Keys. To test this out, compare this code with the [prior NASA example](https://github.com/ixd-system-design/UI-for-Data-Fetching/tree/main/nasa), in which our API Key was publicly visible. 

## Learning Prompts
Can you add your own Nasa API Key to the environment in order to make this code function?
- Create a `.env` (dotenv) file in your project folder to set the `NASA_KEY` environment variable. (Use .env.example as a model).
- It may look something like this:

```
NASA_KEY=abc123def456...
```

## Local Development
 You will need [NodeJS](https://nodejs.org) to work on this project; Install it first if you haven't already. This is a template repo; you can make your own repository via the `Use this template` button in GitHub. Once you have your own repo, clone it to your local machine in VSCode. Then, open the terminal and run: `npm install`. This will install dependencies including Express. Then create a `.env` file using `.env.example` as a model. Populate it with your actual API key from NASA. Finally, run the app with the following terminal command: `npm run start`.

## Vercel
This project uses the [Express](https://expressjs.com) framework in a manner [supported by Vercel](https://vercel.com/docs/frameworks/backend/express). You can host an Express app for free as a [Vercel Function](https://vercel.com/docs/functions) a on a [Vercel Hobby Plan](https://vercel.com/docs/plans/hobby). When deploying to Vercel you can set your Environment Variables (e.g. `NASA_KEY`) during the deploy process.