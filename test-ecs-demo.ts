#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { TestEcsDemoStack } from '../lib/test-ecs-demo-stack';
import { PipelineStack } from '../lib/pipeline-stack';
import { VpcAttributes } from '@aws-cdk/aws-ec2';

const nbcPreprod  = {account: '<>', region: 'us-west-2'};

const vpcNBCDev: VpcAttributes  = {
  vpcId: "vpc-",
  availabilityZones: ["us-west-2b", "us-west-2a"],
  isolatedSubnetIds: ["<>", "<>"]  
};

const app = new cdk.App();

const nbcDevStack = new TestEcsDemoStack(app, 'SafeTestECSServiceStack', {env: nbcPreprod}, {environmentName: "dev", nbcEnvironment: true ,vpcDescription: vpcNBCDev,
  executionRoleArn: "arn:aws:iam::<>:role/ecsTaskExecutionRole", 
  taskRoleArn: "arn:aws:iam::<>:role/ecsTaskExecutionRole"});

new PipelineStack(app, 'PipelineDeployingSafeApiStack', {
    env: nbcPreprod,
    devRepository: nbcDevStack.parameterRegistry,
    //qaRepository: qaStack.parameterRegistry,
    //stagingRepository: stagingStack.parameterRegistry,
    devAccount: nbcPreprod.account,
    //qaAccount: safeQA.account,
    //stagingAccount: safeStaging.account,
    //lambdaCodeDev: devStack.lambdaCodeForSecretReader,
    //lambdaCodeQA: qaStack.lambdaCodeForSecretReader,
    //lambdaCodeStaging: stagingStack.lambdaCodeForSecretReader
  });


app.synth();
